# CartBoost - Cloudflare Workers + D1 Serverless Backend

100% Free Serverless backend for CartBoost. Zero servers to manage, zero credit card required, instant global deployment.

---

## 3-Step Deployment Guide

### 1. Log in to Cloudflare CLI
From this folder:
```bash
npx wrangler login
```
*(Opens your browser to sign in to your free Cloudflare account).*

---

### 2. Create the D1 Database & Tables
```bash
# 1. Create the D1 database
npx wrangler d1 create cartboost_db

# 2. Copy the database_id printed on screen into wrangler.toml under database_id = "..."

# 3. Create the database tables
npx wrangler d1 execute cartboost_db --file=./schema.sql
```

---

### 3. Set your Shopify API Secret & Deploy
```bash
# 1. Add your Shopify Client Secret (from Shopify Partner Dashboard)
npx wrangler secret put SHOPIFY_API_SECRET

# 2. Deploy live to Cloudflare's Edge
npx wrangler deploy
```

---

### 4. Update Shopify Partner Dashboard
Cloudflare will give you your live URL (e.g. `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev`).
In [Shopify Partner Dashboard](https://partners.shopify.com/) ➔ **Apps** ➔ **cartboost** ➔ **App setup**:
* **App URL**: `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev`
* **Allowed redirection URL(s)**: `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev/auth/callback`
* **Mandatory compliance webhooks**:
  * Data request: `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev/webhooks`
  * Customer deletion: `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev/webhooks`
  * Shop deletion: `https://cartboost-api.YOUR_SUBDOMAIN.workers.dev/webhooks`
