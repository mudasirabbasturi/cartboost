# CartBoost - Pure Core PHP & MySQL Backend

This folder contains the complete, production-ready Core PHP & MySQL backend for **CartBoost**. It runs natively on any standard cPanel / GoDaddy hosting with zero Docker and zero Node.js process managers.

---

## 3-Minute GoDaddy cPanel Setup

### 1. Create your MySQL Database in cPanel
1. Log into your **GoDaddy cPanel**.
2. Go to **MySQL Databases**:
   * Create a new database (e.g. `cpaneluser_cartboost`).
   * Create a new database user with a secure password.
   * Add the user to the database and check **ALL PRIVILEGES**.
3. Open **phpMyAdmin** in cPanel:
   * Select your newly created database.
   * Click the **Import** tab at the top.
   * Choose the [`schema.sql`](file:///D:/projects/cartboost/php-backend/schema.sql) file from this folder and click **Import**.
   * It creates the 3 tables: `sessions`, `settings`, `discount_offers`.

---

### 2. Configure `config.php`
Open `config.php` and fill in your details:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_cpanel_database_name');
define('DB_USER', 'your_cpanel_database_user');
define('DB_PASS', 'your_database_password');

define('SHOPIFY_API_KEY', '38b390284d1199e6cfc3cb637d8e1c44');
define('SHOPIFY_API_SECRET', 'YOUR_SHOPIFY_CLIENT_SECRET'); // from Shopify Partner Dashboard

// Your live domain where this folder is hosted:
define('APP_URL', 'https://cartboost.yourdomain.com'); 
```

---

### 3. Update Shopify Partner Dashboard URLs
1. Open your [Shopify Partner Dashboard](https://partners.shopify.com/).
2. Click **Apps** ➔ **cartboost** ➔ **App setup** (left sidebar).
3. Set the URLs:
   * **App URL**: `https://cartboost.yourdomain.com`
   * **Allowed redirection URL(s)**: `https://cartboost.yourdomain.com/auth.php`
4. Under **Mandatory compliance webhooks**:
   * **Data request endpoint**: `https://cartboost.yourdomain.com/webhooks.php`
   * **Customer deletion endpoint**: `https://cartboost.yourdomain.com/webhooks.php`
   * **Shop deletion endpoint**: `https://cartboost.yourdomain.com/webhooks.php`
5. Click **Save**!

---

## File Overview

| File | Purpose |
| :--- | :--- |
| `schema.sql` | Ready-made MySQL database schema to import in phpMyAdmin |
| `config.php` | Database connection (PDO), Shopify credentials, GraphQL cURL & HMAC helper functions |
| `auth.php` | Shopify OAuth 2.0 install & access token exchange |
| `index.php` | Merchant admin dashboard: Free Shipping progress bar settings, live preview, color pickers |
| `offers.php` | BOGO manager: create, edit, pause, resume, and delete Buy X Get Y Free offers |
| `webhooks.php` | HMAC-verified router for GDPR compliance (`customers/data_request`, `customers/redact`, `shop/redact`) |

