-- ==========================================================
-- CartBoost Database Schema for MySQL / phpMyAdmin (cPanel)
-- ==========================================================

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(255) NOT NULL,
  `state` VARCHAR(255) NOT NULL,
  `is_online` TINYINT(1) NOT NULL DEFAULT 0,
  `scope` TEXT NULL,
  `expires` DATETIME NULL,
  `access_token` VARCHAR(255) NOT NULL,
  `user_id` BIGINT NULL,
  `first_name` VARCHAR(255) NULL,
  `last_name` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_sessions_shop` (`shop`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shop` VARCHAR(255) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `threshold_amount` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `message` VARCHAR(255) NOT NULL DEFAULT "You're {amount} away from FREE shipping!",
  `success_message` VARCHAR(255) NOT NULL DEFAULT "Congratulations! You've unlocked FREE shipping!",
  `empty_message` VARCHAR(255) NOT NULL DEFAULT "Free shipping on orders over {amount}!",
  `bar_color` VARCHAR(32) NOT NULL DEFAULT '#108043',
  `bar_bg_color` VARCHAR(32) NOT NULL DEFAULT '#e0e0e0',
  `text_color` VARCHAR(32) NOT NULL DEFAULT '#202223',
  `bar_height` INT NOT NULL DEFAULT 8,
  `bar_shape` VARCHAR(32) NOT NULL DEFAULT 'rounded',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_settings_shop` (`shop`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `discount_offers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `shop` VARCHAR(255) NOT NULL,
  `shopify_discount_id` VARCHAR(255) NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT 'Buy 2 Get 1 FREE',
  `buy_quantity` INT NOT NULL DEFAULT 2,
  `get_quantity` INT NOT NULL DEFAULT 1,
  `discount_percentage` DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  `applies_to_all` TINYINT(1) NOT NULL DEFAULT 1,
  `eligible_product_ids` TEXT NOT NULL,
  `same_product_only` TINYINT(1) NOT NULL DEFAULT 0,
  `combines_with_order` TINYINT(1) NOT NULL DEFAULT 1,
  `combines_with_product` TINYINT(1) NOT NULL DEFAULT 1,
  `combines_with_shipping` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('ACTIVE', 'PAUSED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_offers_shop` (`shop`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
