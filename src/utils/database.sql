-- ============================================================
-- HOCICO PET SHOP — Esquema de Base de Datos (actualizado)
-- Incluye: Wompi (pagos COP), Factus (facturación electrónica),
--          inventario (kardex), zonas de envío y punto de venta (POS)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `railway`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `railway`;

-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `description` VARCHAR(255),
  `permissions` JSON,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT NOT NULL DEFAULT 2,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(50),
  `address` TEXT,
  `city` VARCHAR(100),
  `province` VARCHAR(100),
  `avatar_url` VARCHAR(500),
  `is_active` BOOLEAN DEFAULT TRUE,
  `email_verified` BOOLEAN DEFAULT FALSE,
  `last_login` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT,
  INDEX `idx_users_email` (`email`),
  INDEX `idx_users_role` (`role_id`),
  INDEX `idx_users_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(120) NOT NULL UNIQUE,
  `description` TEXT,
  `image_url` VARCHAR(500),
  `parent_id` INT NULL,
  `seo_title` VARCHAR(200),
  `seo_description` VARCHAR(300),
  `is_active` BOOLEAN DEFAULT TRUE,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL,
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  INDEX `idx_categories_slug` (`slug`),
  INDEX `idx_categories_active` (`is_active`),
  INDEX `idx_categories_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- BRANDS
-- ============================================================
CREATE TABLE IF NOT EXISTS `brands` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `slug` VARCHAR(120) NOT NULL UNIQUE,
  `description` TEXT,
  `logo_url` VARCHAR(500),
  `website_url` VARCHAR(500),
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category_id` INT NOT NULL,
  `brand_id` INT NULL,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(280) NOT NULL UNIQUE,
  `sku` VARCHAR(100) NOT NULL UNIQUE,
  `barcode` VARCHAR(50) NULL,
  `short_description` TEXT,
  `description` LONGTEXT,
  `specifications` JSON,
  `features` JSON,
  `warranty` TEXT,
  `price` DECIMAL(12,2) NOT NULL,
  `original_price` DECIMAL(12,2) NULL,
  `discount_percent` INT DEFAULT 0,
  `cost_price` DECIMAL(12,2) NULL,
  `stock` INT NOT NULL DEFAULT 0,
  `min_stock` INT DEFAULT 5,
  `weight` DECIMAL(8,3) NULL,
  `dimensions` VARCHAR(100) NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `is_featured` BOOLEAN DEFAULT FALSE,
  `is_new` BOOLEAN DEFAULT FALSE,
  `is_on_sale` BOOLEAN DEFAULT FALSE,
  `sale_starts_at` TIMESTAMP NULL,
  `sale_ends_at` TIMESTAMP NULL,
  `meta_title` VARCHAR(200),
  `meta_description` VARCHAR(300),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL,
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_products_brand` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`) ON DELETE SET NULL,
  UNIQUE KEY `uniq_products_barcode` (`barcode`),
  INDEX `idx_products_slug` (`slug`),
  INDEX `idx_products_sku` (`sku`),
  INDEX `idx_products_category` (`category_id`),
  INDEX `idx_products_brand` (`brand_id`),
  INDEX `idx_products_active` (`is_active`),
  INDEX `idx_products_featured` (`is_featured`),
  INDEX `idx_products_on_sale` (`is_on_sale`),
  INDEX `idx_products_price` (`price`),
  INDEX `idx_products_created` (`created_at`),
  FULLTEXT `idx_products_search` (`name`, `short_description`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PRODUCT IMAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS `product_images` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `alt_text` VARCHAR(255),
  `is_main` BOOLEAN DEFAULT FALSE,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_product_images_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  INDEX `idx_product_images_product` (`product_id`),
  INDEX `idx_product_images_main` (`product_id`, `is_main`),
  UNIQUE KEY `uniq_product_image` (`product_id`, `url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CART ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS `cart_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `session_id` VARCHAR(255) NULL,
  `product_id` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cart_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  INDEX `idx_cart_items_user` (`user_id`),
  INDEX `idx_cart_items_session` (`session_id`),
  INDEX `idx_cart_items_product` (`product_id`),
  UNIQUE KEY `unique_user_product` (`user_id`, `product_id`),
  UNIQUE KEY `unique_session_product` (`session_id`, `product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INVOICES (Factus) — se crea antes de orders por el FK cruzado
-- ============================================================
CREATE TABLE IF NOT EXISTS `invoices` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `factus_id` VARCHAR(100) NULL,
  `invoice_number` VARCHAR(50) NULL,
  `cufe` VARCHAR(255) NULL,
  `status` ENUM('pending','issued','error','cancelled') DEFAULT 'pending',
  `xml_url` VARCHAR(500) NULL,
  `pdf_url` VARCHAR(500) NULL,
  `factus_response` JSON NULL,
  `error_message` TEXT NULL,
  `issued_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_invoices_order` (`order_id`),
  INDEX `idx_invoices_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- CASH REGISTERS (control de caja para POS)
-- ============================================================
CREATE TABLE IF NOT EXISTS `cash_registers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `opening_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `closing_amount` DECIMAL(12,2) NULL,
  `expected_amount` DECIMAL(12,2) NULL,
  `difference` DECIMAL(12,2) NULL,
  `status` ENUM('open','closed') NOT NULL DEFAULT 'open',
  `opened_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `closed_at` TIMESTAMP NULL,
  `notes` TEXT NULL,
  CONSTRAINT `fk_cash_registers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  INDEX `idx_cash_registers_user` (`user_id`),
  INDEX `idx_cash_registers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ORDERS — con datos de facturación (CC/NIT) y pago Wompi/COP/POS
-- ============================================================
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `order_number` VARCHAR(50) NOT NULL UNIQUE,
  `channel` ENUM('online','pos') NOT NULL DEFAULT 'online',
  `status` ENUM('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
  `payment_status` ENUM('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process', 'in_mediation', 'charged_back') DEFAULT 'pending',
  `payment_method` ENUM('wompi', 'whatsapp', 'bank_transfer', 'cash_on_delivery', 'cash', 'card_pos') NOT NULL,
  `subtotal` DECIMAL(12,2) NOT NULL,
  `discount` DECIMAL(12,2) DEFAULT 0,
  `shipping_cost` DECIMAL(12,2) DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) DEFAULT 'COP',
  `customer_name` VARCHAR(200) NOT NULL,
  `customer_email` VARCHAR(255) NOT NULL,
  `customer_phone` VARCHAR(50) NOT NULL,
  `customer_document_type` ENUM('CC','NIT','CE','PASSPORT') NOT NULL DEFAULT 'CC',
  `customer_document_number` VARCHAR(20) NOT NULL DEFAULT '',
  `address` TEXT NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `province` VARCHAR(100) NOT NULL,
  `notes` TEXT,
  `payment_id` VARCHAR(100),
  `invoice_id` INT NULL,
  `cash_register_id` INT NULL,
  `external_reference` VARCHAR(100),
  `paid_at` TIMESTAMP NULL,
  `shipped_at` TIMESTAMP NULL,
  `delivered_at` TIMESTAMP NULL,
  `cancelled_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_orders_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_orders_cash_register` FOREIGN KEY (`cash_register_id`) REFERENCES `cash_registers` (`id`) ON DELETE SET NULL,
  INDEX `idx_orders_user` (`user_id`),
  INDEX `idx_orders_number` (`order_number`),
  INDEX `idx_orders_channel` (`channel`),
  INDEX `idx_orders_status` (`status`),
  INDEX `idx_orders_payment_status` (`payment_status`),
  INDEX `idx_orders_payment_id` (`payment_id`),
  INDEX `idx_orders_created` (`created_at`),
  INDEX `idx_orders_external_ref` (`external_reference`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoices_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;

-- ============================================================
-- ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `product_sku` VARCHAR(100),
  `product_slug` VARCHAR(280),
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `discount_price` DECIMAL(12,2) NULL,
  `subtotal` DECIMAL(12,2) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL,
  INDEX `idx_order_items_order` (`order_id`),
  INDEX `idx_order_items_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ORDER STATUS HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS `order_status_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `status` VARCHAR(50) NOT NULL,
  `previous_status` VARCHAR(50),
  `changed_by` INT NULL,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_order_status_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_order_status_history_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_order_status_history_order` (`order_id`),
  INDEX `idx_order_status_history_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PAYMENTS — con referencia y validación de firma Wompi
-- ============================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `payment_id` VARCHAR(100) NOT NULL,
  `reference` VARCHAR(100) NULL,
  `payment_method_id` VARCHAR(100),
  `payment_type` VARCHAR(50),
  `status` VARCHAR(50) NOT NULL,
  `status_detail` VARCHAR(100),
  `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) DEFAULT 'COP',
  `fee` DECIMAL(12,2) DEFAULT 0,
  `net_amount` DECIMAL(12,2),
  `payer_email` VARCHAR(255),
  `payer_id` VARCHAR(100),
  `external_reference` VARCHAR(100),
  `raw_data` JSON,
  `signature_checked` BOOLEAN DEFAULT FALSE,
  `processed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  INDEX `idx_payments_order` (`order_id`),
  UNIQUE KEY `uniq_payments_payment_id` (`payment_id`),
  UNIQUE KEY `uniq_payments_reference` (`reference`),
  INDEX `idx_payments_status` (`status`),
  INDEX `idx_payments_external_ref` (`external_reference`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `order_id` INT NULL,
  `rating` TINYINT NOT NULL CHECK (`rating` BETWEEN 1 AND 5),
  `title` VARCHAR(255),
  `comment` TEXT,
  `is_verified` BOOLEAN DEFAULT FALSE,
  `is_approved` BOOLEAN DEFAULT FALSE,
  `helpful_count` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_reviews_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reviews_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reviews_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  INDEX `idx_reviews_product` (`product_id`),
  INDEX `idx_reviews_user` (`user_id`),
  INDEX `idx_reviews_approved` (`is_approved`),
  UNIQUE KEY `unique_user_product_order` (`user_id`, `product_id`, `order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  `value` JSON,
  `description` VARCHAR(255),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`key`, `value`, `description`) VALUES
  ('site_name', '"Hocico Pet Shop"', 'Nombre del sitio'),
  ('site_url', '"https://hocico.com.co"', 'URL del sitio'),
  ('whatsapp_number', '"573133245600"', 'Número de WhatsApp para pedidos'),
  ('free_shipping_threshold', '100000', 'Monto mínimo para envío gratis'),
  ('default_currency', '"COP"', 'Moneda por defecto'),
  ('site_currency', '"COP"', 'Moneda del sitio (alias de default_currency)'),
  ('tax_rate', '0.19', 'Tasa de IVA en Colombia (19%)'),
  ('wompi_public_key', 'null', 'Llave pública de Wompi (sandbox/producción)'),
  ('wompi_env', '"sandbox"', 'Entorno de Wompi: sandbox o production'),
  ('wompi_enabled', 'true', 'Habilitar pagos con Wompi'),
  ('factus_email', 'null', 'Email de la cuenta Factus'),
  ('pos_enabled', 'true', 'Habilitar módulo de punto de venta (tienda física)'),
  ('maintenance_mode', 'false', 'Modo mantenimiento')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- ============================================================
-- STOCK MOVEMENTS (kardex de inventario)
-- ============================================================
CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `type` ENUM('in','out','adjustment') NOT NULL,
  `quantity` INT NOT NULL,
  `reason` VARCHAR(255) NULL,
  `reference_type` ENUM('order','manual','purchase') DEFAULT 'manual',
  `reference_id` INT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_stock_movements_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_movements_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_stock_movements_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SHIPPING ZONES (Mosquera, Madrid, Funza)
-- ============================================================
CREATE TABLE IF NOT EXISTS `shipping_zones` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `city` VARCHAR(100) NOT NULL,
  `cost` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `shipping_zones` (`city`, `cost`) VALUES
  ('Mosquera', 0),
  ('Madrid', 5000),
  ('Funza', 5000);