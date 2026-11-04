import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncStorefrontMetafield } from "../metafield.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.settings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = {
      enabled: true,
      thresholdAmount: 50,
      message: "You're {amount} away from FREE shipping!",
      successMessage: "Congratulations! You've unlocked FREE shipping!",
      emptyMessage: "Free shipping on orders over {amount}!",
      barColor: "#108043",
      barBgColor: "#e0e0e0",
      textColor: "#202223",
      barHeight: 8,
      barShape: "rounded",
    };
  }

  return {
    shop,
    settings,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const enabled = formData.get("enabled") === "true";
  const thresholdAmount = parseFloat(formData.get("thresholdAmount")) || 50;
  const message =
    formData.get("message") || "You're {amount} away from FREE shipping!";
  const successMessage =
    formData.get("successMessage") ||
    "Congratulations! You've unlocked FREE shipping!";
  const emptyMessage =
    formData.get("emptyMessage") || "Free shipping on orders over {amount}!";
  const barColor = formData.get("barColor") || "#108043";
  const barBgColor = formData.get("barBgColor") || "#e0e0e0";
  const textColor = formData.get("textColor") || "#202223";
  const barHeight = parseInt(formData.get("barHeight"), 10) || 8;
  const barShape = formData.get("barShape") || "rounded";

  // 1. Save settings to Prisma DB
  const updatedSettings = await prisma.settings.upsert({
    where: { shop },
    create: {
      shop,
      enabled,
      thresholdAmount,
      message,
      successMessage,
      emptyMessage,
      barColor,
      barBgColor,
      textColor,
      barHeight,
      barShape,
    },
    update: {
      enabled,
      thresholdAmount,
      message,
      successMessage,
      emptyMessage,
      barColor,
      barBgColor,
      textColor,
      barHeight,
      barShape,
    },
  });

  // 2. Sync unified config (settings + all active BOGO offers) to shop metafield
  await syncStorefrontMetafield(admin, shop);

  return {
    success: true,
    settings: updatedSettings,
  };
};

export default function SettingsPage() {
  const { shop, settings: initialSettings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const isSaving =
    fetcher.state === "submitting" || fetcher.state === "loading";

  // Form states for live preview
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [thresholdAmount, setThresholdAmount] = useState(
    initialSettings.thresholdAmount
  );
  const [message, setMessage] = useState(initialSettings.message);
  const [successMessage, setSuccessMessage] = useState(
    initialSettings.successMessage
  );
  const [emptyMessage, setEmptyMessage] = useState(
    initialSettings.emptyMessage
  );
  const [barColor, setBarColor] = useState(initialSettings.barColor);
  const [barBgColor, setBarBgColor] = useState(initialSettings.barBgColor);
  const [textColor, setTextColor] = useState(initialSettings.textColor);
  const [barHeight, setBarHeight] = useState(initialSettings.barHeight);
  const [barShape, setBarShape] = useState(initialSettings.barShape);

  // Live preview test simulation state
  const [simulatedCartTotal, setSimulatedCartTotal] = useState(25);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Settings saved and synced to storefront!");
    }
  }, [fetcher.data, shopify]);

  // Compute live preview text & percentage
  const threshold = parseFloat(thresholdAmount) || 50;
  let previewText = "";
  let previewPct = 0;

  if (simulatedCartTotal === 0) {
    previewPct = 0;
    previewText = emptyMessage.replace("{amount}", `$${threshold.toFixed(2)}`);
  } else if (simulatedCartTotal >= threshold) {
    previewPct = 100;
    previewText = successMessage;
  } else {
    const remaining = Math.max(0, threshold - simulatedCartTotal);
    previewPct = Math.min(100, Math.max(0, (simulatedCartTotal / threshold) * 100));
    previewText = message.replace("{amount}", `$${remaining.toFixed(2)}`);
  }

  const themeEditorEmbedUrl = `https://${shop}/admin/themes/current/editor?context=apps`;
  const themeEditorCartUrl = `https://${shop}/admin/themes/current/editor?template=cart`;

  return (
    <s-page heading="CartBoost — Free Shipping Bar">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isSaving ? "true" : undefined}
        onClick={() => {
          const form = document.getElementById("cartboost-settings-form");
          if (form) form.requestSubmit();
        }}
      >
        Save Settings
      </s-button>

      {/* Onboarding Guide Banner */}
      <s-section heading="Getting Started (2-Minute Setup)">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              backgroundColor: "#f0f7f4",
              borderRadius: "8px",
              border: "1px solid #c2e2d3",
            }}
          >
            <div>
              <strong>Step 1: Turn on the App Embed</strong>
              <div style={{ fontSize: "13px", color: "#4a5568", marginTop: "2px" }}>
                Displays the universal top shipping progress bar across all pages.
              </div>
            </div>
            <s-button
              href={themeEditorEmbedUrl}
              target="_blank"
              variant="secondary"
            >
              Open Theme App Embeds ↗
            </s-button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              backgroundColor: "#f7fafc",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
            }}
          >
            <div>
              <strong>Step 2: Add App Blocks to Cart & Product Pages</strong>
              <div style={{ fontSize: "13px", color: "#4a5568", marginTop: "2px" }}>
                Adds the shipping progress bar to the cart, or the BOGO Offer Badge to product pages.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <s-button
                href={themeEditorCartUrl}
                target="_blank"
                variant="secondary"
              >
                Cart Page ↗
              </s-button>
              <s-button
                href={`https://${shop}/admin/themes/current/editor?template=product`}
                target="_blank"
                variant="secondary"
              >
                Product Page ↗
              </s-button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              backgroundColor: "#fdf8ec",
              borderRadius: "8px",
              border: "1px solid #f6e0b5",
            }}
          >
            <div>
              <strong>Step 3: Manage Buy X Get Y Free Promotions</strong>
              <div style={{ fontSize: "13px", color: "#6b5826", marginTop: "2px" }}>
                Create, edit, pause, and delete your BOGO offers (Buy 3 Get 1 Free).
              </div>
            </div>
            <s-button
              href="/app/offers"
              variant="primary"
            >
              Manage Offers 🎁
            </s-button>
          </div>
        </div>
      </s-section>

      {/* Live Preview Card */}
      <s-section heading="Live Interactive Preview">
        <div
          style={{
            background: "#ffffff",
            padding: "24px",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ marginBottom: "16px", fontSize: "13px", color: "#616161" }}>
            This is how the bar looks to shoppers on your storefront in real time:
          </div>

          {/* Rendered Bar */}
          <div
            style={{
              padding: "14px 20px",
              backgroundColor: "#fafbfb",
              borderRadius: "8px",
              border: "1px dashed #c9cccf",
              marginBottom: "20px",
            }}
          >
            {!enabled ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#d72c0d",
                  padding: "10px",
                  fontWeight: 500,
                }}
              >
                ⚠️ Shipping Bar is currently Disabled (it will not appear on storefront)
              </div>
            ) : (
              <div style={{ textAlign: "center", maxWidth: "600px", margin: "0 auto" }}>
                <div
                  style={{
                    color: simulatedCartTotal >= threshold ? barColor : textColor,
                    fontWeight: 600,
                    marginBottom: "8px",
                    fontSize: "14px",
                  }}
                >
                  {previewText}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: `${barHeight}px`,
                    backgroundColor: barBgColor,
                    borderRadius: barShape === "rounded" ? "9999px" : "0px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${previewPct}%`,
                      backgroundColor: barColor,
                      borderRadius: barShape === "rounded" ? "9999px" : "0px",
                      transition: "width 0.4s ease-in-out",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Simulation Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "12px",
              borderTop: "1px solid #f1f2f3",
              fontSize: "13px",
            }}
          >
            <span>
              <strong>Simulate Cart Total:</strong> ${simulatedCartTotal.toFixed(2)}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setSimulatedCartTotal(0)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  background: simulatedCartTotal === 0 ? "#e3e8ee" : "#fff",
                  cursor: "pointer",
                }}
              >
                $0 (Empty)
              </button>
              <button
                type="button"
                onClick={() => setSimulatedCartTotal(threshold / 2)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  background:
                    simulatedCartTotal === threshold / 2 ? "#e3e8ee" : "#fff",
                  cursor: "pointer",
                }}
              >
                ${(threshold / 2).toFixed(0)} (50%)
              </button>
              <button
                type="button"
                onClick={() => setSimulatedCartTotal(threshold)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  background:
                    simulatedCartTotal >= threshold ? "#e3e8ee" : "#fff",
                  cursor: "pointer",
                }}
              >
                ${threshold.toFixed(0)} (Goal Met 🎉)
              </button>
            </div>
          </div>
        </div>
      </s-section>

      {/* Settings Form */}
      <s-section heading="Shipping Bar Configuration">
        <fetcher.Form
          method="post"
          id="cartboost-settings-form"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            background: "#ffffff",
            padding: "24px",
            borderRadius: "10px",
            border: "1px solid #e1e3e5",
          }}
        >
          {/* Status Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="checkbox"
              id="enabled"
              name="enabled"
              value="true"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: "18px", height: "18px", cursor: "pointer" }}
            />
            <label htmlFor="enabled" style={{ fontWeight: 600, cursor: "pointer" }}>
              Enable Free Shipping Bar on Storefront
            </label>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "4px 0" }} />

          {/* Threshold Amount */}
          <div>
            <label
              htmlFor="thresholdAmount"
              style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
            >
              Free Shipping Threshold ($)
            </label>
            <input
              type="number"
              id="thresholdAmount"
              name="thresholdAmount"
              min="1"
              step="any"
              value={thresholdAmount}
              onChange={(e) => setThresholdAmount(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "280px",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #ccc",
                fontSize: "14px",
              }}
              required
            />
            <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
              The cart total required to unlock free shipping.
            </div>
          </div>

          {/* Messages */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label
                htmlFor="emptyMessage"
                style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
              >
                Initial / Empty Cart Message
              </label>
              <input
                type="text"
                id="emptyMessage"
                name="emptyMessage"
                value={emptyMessage}
                onChange={(e) => setEmptyMessage(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                }}
              />
              <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                Use <code>{"{amount}"}</code> to display the threshold.
              </div>
            </div>

            <div>
              <label
                htmlFor="message"
                style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
              >
                Progress Message
              </label>
              <input
                type="text"
                id="message"
                name="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                }}
              />
              <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                Use <code>{"{amount}"}</code> to display remaining amount needed.
              </div>
            </div>

            <div>
              <label
                htmlFor="successMessage"
                style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
              >
                Goal Achieved (Success) Message
              </label>
              <input
                type="text"
                id="successMessage"
                name="successMessage"
                value={successMessage}
                onChange={(e) => setSuccessMessage(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                }}
              />
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "4px 0" }} />

          {/* Appearance Styling */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: "12px" }}>
              Appearance & Styling
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
                marginBottom: "16px",
              }}
            >
              <div>
                <label
                  htmlFor="barColor"
                  style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}
                >
                  Progress Bar Fill Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    id="barColorPicker"
                    value={barColor}
                    onChange={(e) => setBarColor(e.target.value)}
                    style={{
                      width: "36px",
                      height: "36px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="text"
                    id="barColor"
                    name="barColor"
                    value={barColor}
                    onChange={(e) => setBarColor(e.target.value)}
                    style={{
                      width: "100px",
                      padding: "6px 8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="barBgColor"
                  style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}
                >
                  Bar Background Track
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    id="barBgColorPicker"
                    value={barBgColor}
                    onChange={(e) => setBarBgColor(e.target.value)}
                    style={{
                      width: "36px",
                      height: "36px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="text"
                    id="barBgColor"
                    name="barBgColor"
                    value={barBgColor}
                    onChange={(e) => setBarBgColor(e.target.value)}
                    style={{
                      width: "100px",
                      padding: "6px 8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="textColor"
                  style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}
                >
                  Text Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    id="textColorPicker"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    style={{
                      width: "36px",
                      height: "36px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="text"
                    id="textColor"
                    name="textColor"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    style={{
                      width: "100px",
                      padding: "6px 8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label
                  htmlFor="barHeight"
                  style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}
                >
                  Bar Height: <strong>{barHeight}px</strong>
                </label>
                <input
                  type="range"
                  id="barHeight"
                  name="barHeight"
                  min="4"
                  max="24"
                  step="2"
                  value={barHeight}
                  onChange={(e) => setBarHeight(e.target.value)}
                  style={{ width: "100%", maxWidth: "260px" }}
                />
              </div>

              <div>
                <label
                  htmlFor="barShape"
                  style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}
                >
                  Corner Style
                </label>
                <select
                  id="barShape"
                  name="barShape"
                  value={barShape}
                  onChange={(e) => setBarShape(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    fontSize: "14px",
                    background: "#fff",
                  }}
                >
                  <option value="rounded">Rounded Pill</option>
                  <option value="square">Square</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "16px" }}>
            <s-button
              type="submit"
              variant="primary"
              loading={isSaving ? "true" : undefined}
            >
              Save Settings
            </s-button>
          </div>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error();
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
