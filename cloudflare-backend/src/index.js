/**
 * CartBoost - Cloudflare Workers + D1 Serverless Backend
 * Handles OAuth, Merchant Dashboard, GraphQL Mutations, and Webhooks
 */

// Helper: HMAC SHA-256 using native Web Crypto API
async function verifyHmac(message, secret, signature) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.toLowerCase() === (signature || "").toLowerCase();
}

async function verifyWebhookHmac(data, secret, hmacHeader) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return base64 === hmacHeader;
}

// Helper: Shopify GraphQL Admin API Call
async function shopifyGraphQL(shop, accessToken, query, variables = {}, apiVersion = "2025-01") {
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
      "User-Agent": "CartBoost-Cloudflare/1.0"
    },
    body: JSON.stringify({ query, variables })
  });
  return await res.json();
}

// Helper: Sync Storefront Metafield ($app:config)
async function syncStorefrontMetafield(db, env, shop, accessToken) {
  try {
    const sRes = await shopifyGraphQL(shop, accessToken, "query { shop { id } }");
    const shopId = sRes?.data?.shop?.id;
    if (!shopId) return false;

    // Get settings from D1
    const settings = await db.prepare("SELECT * FROM settings WHERE shop = ?").bind(shop).first() || {
      enabled: 1,
      threshold_amount: 50.0,
      message: "You're {amount} away from FREE shipping!",
      success_message: "Congratulations! You've unlocked FREE shipping!",
      empty_message: "Free shipping on orders over {amount}!",
      bar_color: "#108043",
      bar_bg_color: "#e0e0e0",
      text_color: "#202223",
      bar_height: 6,
      bar_shape: "rounded"
    };

    // Get active offers from D1
    const offersRes = await db.prepare("SELECT * FROM discount_offers WHERE shop = ? AND status = 'ACTIVE' ORDER BY id DESC").bind(shop).all();
    const offers = (offersRes?.results || []).map(o => {
      let pids = [];
      try { pids = JSON.parse(o.eligible_product_ids || "[]"); } catch (e) {}
      return {
        id: String(o.id),
        active: true,
        buyX: Number(o.buy_quantity),
        getY: Number(o.get_quantity),
        title: o.title,
        appliesToAll: Boolean(o.applies_to_all),
        sameProductOnly: Boolean(o.same_product_only),
        eligibleProductIds: pids
      };
    });

    const payload = {
      enabled: Boolean(settings.enabled),
      threshold: Number(settings.threshold_amount),
      message: settings.message,
      successMessage: settings.success_message,
      emptyMessage: settings.empty_message,
      barColor: settings.bar_color,
      barBgColor: settings.bar_bg_color,
      textColor: settings.text_color,
      barHeight: Number(settings.bar_height),
      barShape: settings.bar_shape,
      bogoOffer: offers[0] || null,
      bogoOffers: offers
    };

    const mutation = `mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id value }
        userErrors { field message }
      }
    }`;

    const mRes = await shopifyGraphQL(shop, accessToken, mutation, {
      metafields: [{
        ownerId: shopId,
        namespace: "$app",
        key: "config",
        type: "json",
        value: JSON.stringify(payload)
      }]
    });

    return !mRes?.data?.metafieldsSet?.userErrors?.length;
  } catch (err) {
    console.error("Metafield sync error:", err);
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;
    const apiKey = env.SHOPIFY_API_KEY || "38b390284d1199e6cfc3cb637d8e1c44";
    const apiSecret = env.SHOPIFY_API_SECRET || "";
    const scopes = env.SHOPIFY_SCOPES || "write_products,write_metaobjects,write_metaobject_definitions,write_discounts";

    // -----------------------------------------------------------
    // 1. OAuth Start: /auth?shop=xxx.myshopify.com
    // -----------------------------------------------------------
    if (path === "/auth") {
      const shop = url.searchParams.get("shop");
      if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
        return new Response("Invalid shop parameter", { status: 400 });
      }

      const state = crypto.randomUUID().replace(/-/g, "");
      await db.prepare("INSERT INTO sessions (id, shop, state, access_token) VALUES (?, ?, ?, '') ON CONFLICT(id) DO UPDATE SET state = excluded.state")
        .bind(`offline_${shop}`, shop, state).run();

      const redirectUri = encodeURIComponent(`${url.origin}/auth/callback`);
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${encodeURIComponent(scopes)}&redirect_uri=${redirectUri}&state=${state}`;
      return Response.redirect(installUrl, 302);
    }

    // -----------------------------------------------------------
    // 2. OAuth Callback: /auth/callback
    // -----------------------------------------------------------
    if (path === "/auth/callback") {
      const params = Object.fromEntries(url.searchParams.entries());
      const shop = params.shop;
      const code = params.code;
      const state = params.state;
      const hmac = params.hmac;

      if (!shop || !code) return new Response("Missing parameters", { status: 400 });

      // Verify HMAC
      const copy = { ...params };
      delete copy.hmac;
      delete copy.signature;
      const message = Object.keys(copy).sort().map(k => `${k}=${copy[k]}`).join("&");
      if (apiSecret && !(await verifyHmac(message, apiSecret, hmac))) {
        return new Response("HMAC verification failed", { status: 403 });
      }

      // Verify State
      const existing = await db.prepare("SELECT state FROM sessions WHERE id = ?").bind(`offline_${shop}`).first();
      if (!existing || existing.state !== state) {
        return new Response("State mismatch", { status: 403 });
      }

      // Exchange token
      const tRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code })
      });
      const tData = await tRes.json();
      if (!tData?.access_token) {
        return new Response("Failed to obtain access token", { status: 500 });
      }

      const accessToken = tData.access_token;
      await db.prepare("INSERT INTO sessions (id, shop, state, scope, access_token) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, state = excluded.state")
        .bind(`offline_${shop}`, shop, state, scopes, accessToken).run();

      // Ensure default settings exist
      await db.prepare("INSERT OR IGNORE INTO settings (shop, enabled, threshold_amount) VALUES (?, 1, 50.0)").bind(shop).run();

      // Sync metafield
      await syncStorefrontMetafield(db, env, shop, accessToken);

      const host = url.searchParams.get("host") || "";
      return Response.redirect(`${url.origin}/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`, 302);
    }

    // -----------------------------------------------------------
    // 3. Webhooks & GDPR Compliance: /webhooks
    // -----------------------------------------------------------
    if (path === "/webhooks") {
      const topic = request.headers.get("x-shopify-topic") || "";
      const shop = request.headers.get("x-shopify-shop-domain") || "";
      const hmacHeader = request.headers.get("x-shopify-hmac-sha256") || "";
      const rawBody = await request.text();

      if (apiSecret && !(await verifyWebhookHmac(rawBody, apiSecret, hmacHeader))) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (topic === "shop/redact") {
        await db.prepare("DELETE FROM discount_offers WHERE shop = ?").bind(shop).run();
        await db.prepare("DELETE FROM settings WHERE shop = ?").bind(shop).run();
        await db.prepare("DELETE FROM sessions WHERE shop = ?").bind(shop).run();
      } else if (topic === "app/uninstalled") {
        await db.prepare("DELETE FROM sessions WHERE shop = ?").bind(shop).run();
      }

      // customers/data_request and customers/redact require 200 OK
      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // -----------------------------------------------------------
    // 4. API Endpoints: Save Settings & Manage Offers
    // -----------------------------------------------------------
    if (path === "/api/settings" && request.method === "POST") {
      const shop = url.searchParams.get("shop");
      const session = await db.prepare("SELECT access_token FROM sessions WHERE shop = ?").bind(shop).first();
      if (!session) return new Response("Unauthorized", { status: 401 });

      const body = await request.json();
      await db.prepare(`
        INSERT INTO settings (shop, enabled, threshold_amount, message, success_message, empty_message, bar_color, bar_bg_color, text_color, bar_height, bar_shape, bar_style)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shop) DO UPDATE SET
          enabled = excluded.enabled,
          threshold_amount = excluded.threshold_amount,
          message = excluded.message,
          success_message = excluded.success_message,
          empty_message = excluded.empty_message,
          bar_color = excluded.bar_color,
          bar_bg_color = excluded.bar_bg_color,
          text_color = excluded.text_color,
          bar_height = excluded.bar_height,
          bar_shape = excluded.bar_shape,
          bar_style = excluded.bar_style
      `).bind(
        shop,
        body.enabled ? 1 : 0,
        Number(body.threshold_amount) || 50.0,
        body.message || "You're {amount} away from FREE shipping!",
        body.success_message || "Congratulations! You've unlocked FREE shipping!",
        body.empty_message || "Free shipping on orders over {amount}!",
        body.bar_color || "#108043",
        body.bar_bg_color || "#e0e0e0",
        body.text_color || "#202223",
        Number(body.bar_height) || 6,
        body.bar_shape || "rounded",
        body.bar_style || "standard"
      ).run();

      await syncStorefrontMetafield(db, env, shop, session.access_token);
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }

    // -----------------------------------------------------------
    // 5. Merchant Admin Dashboard (HTML + App Bridge)
    // -----------------------------------------------------------
    const shop = url.searchParams.get("shop") || "";
    const session = await db.prepare("SELECT access_token FROM sessions WHERE shop = ?").bind(shop).first();

    if (!session && shop) {
      return Response.redirect(`${url.origin}/auth?shop=${encodeURIComponent(shop)}`, 302);
    }

    const settings = (await db.prepare("SELECT * FROM settings WHERE shop = ?").bind(shop).first()) || {
      enabled: 1,
      threshold_amount: 50.0,
      message: "You're {amount} away from FREE shipping!",
      success_message: "Congratulations! You've unlocked FREE shipping!",
      empty_message: "Free shipping on orders over {amount}!",
      bar_color: "#108043",
      bar_bg_color: "#e0e0e0",
      text_color: "#202223",
      bar_height: 6,
      bar_shape: "rounded",
      bar_style: "standard"
    };

    const offersRes = await db.prepare("SELECT * FROM discount_offers WHERE shop = ? ORDER BY id DESC").bind(shop).all();
    const offers = offersRes?.results || [];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CartBoost Dashboard (Cloudflare Serverless)</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f2f4; color: #202223; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    .card { background: #ffffff; border-radius: 12px; border: 1px solid #e1e3e5; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card h2 { margin-top: 0; font-size: 18px; font-weight: 700; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .input { width: 100%; padding: 8px 12px; border: 1px solid #c9cccf; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    .btn { background: #008060; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .preview { background: #fafbfb; border: 1px dashed #c9cccf; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 16px; }
    .track { width: 100%; height: 6px; background: #e0e0e0; border-radius: 9999px; overflow: hidden; margin-top: 8px; }
    .fill { width: 50%; height: 100%; background: #108043; transition: width 0.3s; border-radius: 9999px; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: #e3fcef; color: #006644; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>⚡ CartBoost Cloudflare Serverless Dashboard</h2>
      <p style="color: #616161; font-size: 14px;">Running 24/7 on Cloudflare's global edge network with zero server downtime.</p>
    </div>

    <div class="card">
      <h2>Live Storefront Preview</h2>
      <div class="preview">
        <div id="pMsg" style="font-weight: 600; color: ${settings.text_color};">You're $25.00 away from FREE shipping!</div>
        <div class="track" id="pTrack" style="background: ${settings.bar_bg_color}; height: ${settings.bar_height}px;">
          <div class="fill" id="pFill" style="background: ${settings.bar_color};"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Free Shipping Bar Settings</h2>
      <form id="settingsForm">
        <div class="form-group">
          <label><input type="checkbox" id="enabled" ${settings.enabled ? "checked" : ""}> Enable Shipping Bar</label>
        </div>
        <div class="form-group">
          <label>Threshold Amount ($)</label>
          <input type="number" id="threshold_amount" class="input" value="${settings.threshold_amount}" step="0.01">
        </div>
        <div class="form-group">
          <label>Progress Message</label>
          <input type="text" id="message" class="input" value="${settings.message}">
        </div>
        <div class="form-group">
          <label>Success Message</label>
          <input type="text" id="success_message" class="input" value="${settings.success_message}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Bar Color</label>
            <input type="color" id="bar_color" class="input" style="height: 40px;" value="${settings.bar_color}">
          </div>
          <div class="form-group">
            <label>Track Color</label>
            <input type="color" id="bar_bg_color" class="input" style="height: 40px;" value="${settings.bar_bg_color}">
          </div>
          <div class="form-group">
            <label>Text Color</label>
            <input type="color" id="text_color" class="input" style="height: 40px;" value="${settings.text_color}">
          </div>
        </div>
        <button type="submit" class="btn">Save Settings</button>
      </form>
    </div>
  </div>

  <script>
    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        enabled: document.getElementById('enabled').checked,
        threshold_amount: document.getElementById('threshold_amount').value,
        message: document.getElementById('message').value,
        success_message: document.getElementById('success_message').value,
        bar_color: document.getElementById('bar_color').value,
        bar_bg_color: document.getElementById('bar_bg_color').value,
        text_color: document.getElementById('text_color').value
      };
      const res = await fetch('/api/settings?shop=' + encodeURIComponent('${shop}'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) alert('Settings saved and synced to storefront!');
    });
  </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
