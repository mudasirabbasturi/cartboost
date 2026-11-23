-- Cloudflare D1 Database Schema for CartBoost
-- Run: npx wrangler d1 execute cartboost_db --file=./schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  scope TEXT,
  access_token TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1,
  threshold_amount REAL DEFAULT 50.0,
  message TEXT DEFAULT "You're {amount} away from FREE shipping!",
  success_message TEXT DEFAULT "Congratulations! You've unlocked FREE shipping!",
  empty_message TEXT DEFAULT "Free shipping on orders over {amount}!",
  bar_color TEXT DEFAULT '#108043',
  bar_bg_color TEXT DEFAULT '#e0e0e0',
  text_color TEXT DEFAULT '#202223',
  bar_height INTEGER DEFAULT 6,
  bar_shape TEXT DEFAULT 'rounded',
  bar_style TEXT DEFAULT 'standard',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discount_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  shopify_discount_id TEXT,
  title TEXT DEFAULT 'Buy 2 Get 1 FREE',
  buy_quantity INTEGER DEFAULT 2,
  get_quantity INTEGER DEFAULT 1,
  discount_percentage REAL DEFAULT 100.0,
  applies_to_all INTEGER DEFAULT 1,
  eligible_product_ids TEXT DEFAULT '[]',
  same_product_only INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offers_shop ON discount_offers(shop);
