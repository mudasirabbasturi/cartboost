# 📦 CartBoost - Direct Theme Installation Guide (Zero Servers)

This guide shows you how to add the **Free Shipping Bar** and **BOGO Offer Badge** directly to ANY Shopify store in 3 minutes.
**No external servers, no Cloudflare, no OAuth, and no hosting costs!**

---

### 📂 Step 1: Add the 2 Asset Files
In Shopify Admin:
1. Go to **Online Store** ➔ **Themes**.
2. Click the `...` menu next to the theme ➔ **Edit code**.
3. Under **Assets**, click **Add a new asset**:
   - Create `cartboost.css` and paste the contents of `theme-direct/assets/cartboost.css`.
   - Create `cartboost.js` and paste the contents of `theme-direct/assets/cartboost.js`.
4. In `layout/theme.liquid`, right before `</head>`, add:
   ```liquid
   {{ 'cartboost.css' | asset_url | stylesheet_tag }}
   <script src="{{ 'cartboost.js' | asset_url }}" defer="defer"></script>
   ```

---

### 🚚 Step 2: Add Free Shipping Bar Section (Header / Anywhere on Page)
1. Under **Sections**, click **Add a new section**.
2. Name it `free-shipping-bar.liquid`.
3. Paste the contents of `theme-direct/sections/free-shipping-bar.liquid`.
4. Click **Save**.
5. Now open **Customize** (Theme Editor):
   - Click **Add section** anywhere (e.g. Header or Announcement).
   - Select **🚚 Free Shipping Bar**.
   - Change your threshold ($50, $75, etc.), colors, and messages right from the sidebar!

---

### 🛒 Step 3 (Optional): Add Shipping Bar Inside Cart Drawer
If the theme uses a cart drawer (like Dawn's `cart-drawer.liquid`):
1. Under **Snippets**, click **Add a new snippet** named `cart-shipping-bar.liquid`.
2. Paste the contents of `theme-direct/snippets/cart-shipping-bar.liquid`.
3. Open `snippets/cart-drawer.liquid` (or `cart-drawer-items.liquid`), and right above the items list or header, add:
   ```liquid
   {% render 'cart-shipping-bar', threshold: 50, style: 'slim' %}
   ```
   *The `slim` style is a 3px micro-line specifically designed to prevent layout breaks in sliding cart drawers!*

---

### 🎁 Step 4: Native BOGO Discounts (100% Native in Shopify)
To create a Buy 2 Get 1 Free (or Buy X Get Y) discount:
1. In Shopify Admin, go to **Discounts** ➔ **Create discount**.
2. Choose **Buy X get Y**.
3. Set:
   - **Method**: Automatic discount
   - **Customer buys**: Quantity 2 of a product / collection
   - **Customer gets**: Quantity 1 of the product Free (100% off)
4. Click **Save discount**.
5. To show a badge on the product page:
   - In `sections/main-product.liquid` (or by adding a Custom Liquid block in Theme Customize), paste:
     ```liquid
     {% render 'bogo-callout-badge', text: '🔥 Buy 2 Get 1 FREE - Automatic Discount at Checkout' %}
     ```
