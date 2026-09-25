import { query } from '../config/database.js'
import fs from 'fs'
import path from 'path'

const migrations = [
  `CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255),
    permissions JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    role_id INT NOT NULL DEFAULT 2,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    avatar_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (role_id) REFERENCES roles(id),
    INDEX idx_email (email),
    INDEX idx_role (role_id),
    INDEX idx_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    parent_id INT NULL,
    seo_title VARCHAR(200),
    seo_description VARCHAR(300),
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_slug (slug),
    INDEX idx_active (is_active),
    INDEX idx_parent (parent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    logo_url VARCHAR(500),
    website_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    brand_id INT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(280) NOT NULL UNIQUE,
    sku VARCHAR(100) NOT NULL UNIQUE,
    short_description TEXT,
    description LONGTEXT,
    specifications JSON,
    features JSON,
    warranty TEXT,
    price DECIMAL(12,2) NOT NULL,
    original_price DECIMAL(12,2) NULL,
    discount_percent INT DEFAULT 0,
    cost_price DECIMAL(12,2) NULL,
    stock INT NOT NULL DEFAULT 0,
    min_stock INT DEFAULT 5,
    weight DECIMAL(8,3) NULL,
    dimensions VARCHAR(100) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_new BOOLEAN DEFAULT FALSE,
    is_on_sale BOOLEAN DEFAULT FALSE,
    sale_starts_at TIMESTAMP NULL,
    sale_ends_at TIMESTAMP NULL,
    meta_title VARCHAR(200),
    meta_description VARCHAR(300),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    INDEX idx_slug (slug),
    INDEX idx_sku (sku),
    INDEX idx_category (category_id),
    INDEX idx_brand (brand_id),
    INDEX idx_active (is_active),
    INDEX idx_featured (is_featured),
    INDEX idx_on_sale (is_on_sale),
    INDEX idx_price (price),
    INDEX idx_created (created_at),
    FULLTEXT idx_search (name, short_description, description)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    url VARCHAR(500) NOT NULL,
    alt_text VARCHAR(255),
    is_main BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product (product_id),
    INDEX idx_main (product_id, is_main)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    session_id VARCHAR(255) NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_session (session_id),
    INDEX idx_product (product_id),
    UNIQUE KEY unique_user_product (user_id, product_id),
    UNIQUE KEY unique_session_product (session_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    status ENUM('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_status ENUM('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process', 'in_mediation', 'charged_back') DEFAULT 'pending',
    payment_method ENUM('mercadopago', 'whatsapp', 'bank_transfer', 'cash_on_delivery') NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0,
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ARS',
    customer_name VARCHAR(200) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    notes TEXT,
    payment_id VARCHAR(100),
    external_reference VARCHAR(100),
    paid_at TIMESTAMP NULL,
    shipped_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_order_number (order_number),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_created (created_at),
    INDEX idx_external_ref (external_reference)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(100),
    product_slug VARCHAR(280),
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_price DECIMAL(12,2) NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX idx_order (order_id),
    INDEX idx_product (product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS order_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    previous_status VARCHAR(50),
    changed_by INT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_order (order_id),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    payment_id VARCHAR(100) NOT NULL,
    payment_method_id VARCHAR(100),
    payment_type VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    status_detail VARCHAR(100),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ARS',
    fee DECIMAL(12,2) DEFAULT 0,
    net_amount DECIMAL(12,2),
    payer_email VARCHAR(255),
    payer_id VARCHAR(100),
    external_reference VARCHAR(100),
    raw_data JSON,
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order (order_id),
    INDEX idx_payment_id (payment_id),
    INDEX idx_status (status),
    INDEX idx_external_ref (external_reference)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT NULL,
    rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    comment TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    INDEX idx_product (product_id),
    INDEX idx_user (user_id),
    INDEX idx_approved (is_approved),
    UNIQUE KEY unique_user_product_order (user_id, product_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(100) NOT NULL UNIQUE,
    value JSON,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `INSERT IGNORE INTO roles (id, name, description, permissions) VALUES
  (1, 'admin', 'Administrador completo', '{"all": true}'),
  (2, 'user', 'Usuario registrado', '{"orders": ["read", "create"], "profile": ["read", "update"], "cart": ["read", "create", "update", "delete"]}'),
  (3, 'guest', 'Usuario invitado', '{"cart": ["read", "create", "update", "delete"]}');`,

  `INSERT IGNORE INTO categories (id, name, slug, description, image_url, sort_order, is_active) VALUES
  (1, 'Audio', 'audio', 'Auriculares, parlantes y accesorios de audio', '/images/categories/audio.jpg', 1, TRUE),
  (2, 'Smartphones', 'smartphones', 'Teléfonos inteligentes y accesorios', '/images/categories/smartphones.jpg', 2, TRUE),
  (3, 'Computadores', 'computadores', 'Laptops, desktops y accesorios', '/images/categories/computadores.jpg', 3, TRUE),
  (4, 'Gaming', 'gaming', 'Consolas, periféricos y accesorios gaming', '/images/categories/gaming.jpg', 4, TRUE),
  (5, 'Smartwatch', 'smartwatch', 'Relojes inteligentes y wearables', '/images/categories/smartwatch.jpg', 5, TRUE),
  (6, 'Accesorios', 'accesorios', 'Cables, fundas, soportes y más', '/images/categories/accesorios.jpg', 6, TRUE),
  (7, 'Cargadores', 'cargadores', 'Cargadores, power banks y adaptadores', '/images/categories/cargadores.jpg', 7, TRUE),
  (8, 'Periféricos', 'perifericos', 'Teclados, mouse, webcams y más', '/images/categories/perifericos.jpg', 8, TRUE),
  (9, 'Gadgets', 'gadgets', 'Dispositivos innovadores y tecnología', '/images/categories/gadgets.jpg', 9, TRUE);`,

  `INSERT IGNORE INTO brands (id, name, slug, is_active) VALUES
  (1, 'Apple', 'apple', TRUE),
  (2, 'Samsung', 'samsung', TRUE),
  (3, 'Sony', 'sony', TRUE),
  (4, 'Logitech', 'logitech', TRUE),
  (5, 'Xiaomi', 'xiaomi', TRUE),
  (6, 'Microsoft', 'microsoft', TRUE),
  (7, 'Razer', 'razer', TRUE),
  (8, 'ASUS', 'asus', TRUE),
  (9, 'TP-Link', 'tp-link', TRUE),
  (10, 'Anker', 'anker', TRUE);`,

  `INSERT IGNORE INTO settings (\`key\`, value, description) VALUES
  ('site_name', '"TechStore"', 'Nombre del sitio'),
  ('site_url', '"https://techstore.com"', 'URL del sitio'),
  ('whatsapp_number', '"573209088777"', 'Número de WhatsApp para pedidos'),
  ('free_shipping_threshold', '100000', 'Monto mínimo para envío gratis'),
  ('default_currency', '"ARS"', 'Moneda por defecto'),
  ('tax_rate', '0.21', 'Tasa de impuesto (21% IVA)'),
  ('mercadopago_enabled', 'true', 'Habilitar Mercado Pago'),
  ('maintenance_mode', 'false', 'Modo mantenimiento');`,
]

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, '')
        .trim()
    )
    .filter((statement) => {
      if (!statement) return false
      const upper = statement.toUpperCase()
      if (upper.startsWith('CREATE DATABASE')) return false
      if (upper.startsWith('USE ')) return false
      return true
    })
}

export async function runMigrations() {
  console.log('🔄 Running migrations...')
  for (let i = 0; i < migrations.length; i++) {
    try {
      await query(migrations[i])
      console.log(`✅ Migration ${i + 1} completed`)
    } catch (error) {
      console.error(`❌ Migration ${i + 1} failed:`, error.message)
      throw error
    }
  }
  console.log('✅ All migrations completed')
}

export async function runSeed() {
  console.log('🌱 Running seed...')

  const seedPath = path.resolve(process.cwd(), 'seed.sql')

  if (!fs.existsSync(seedPath)) {
    console.log('⚠️  seed.sql not found, skipping seed')
    return 0
  }

  const raw = fs.readFileSync(seedPath, 'utf8')
  const statements = splitSqlStatements(raw)

  console.log(`🌱 seed.sql: ${statements.length} statements found`)

  const { createConnection } = await import('mysql2/promise')
  const conn = await createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: true,
  })

  try {
    let applied = 0

    for (const statement of statements) {
      const head = statement.slice(0, 100).replace(/\s+/g, ' ')

      try {
        await conn.query(statement)
        applied += 1
        console.log(`  ✓ ${head}${statement.length > 100 ? '...' : ''}`)
      } catch (error) {
        const benign =
          error.code === 'ER_TABLE_EXISTS_ERROR' ||
          error.code === 'ER_DUP_KEYNAME' ||
          error.code === 'ER_DUP_ENTRY' ||
          error.code === 'ER_FK_DUP_NAME' ||
          error.code === 'ER_ROW_IS_REFERENCED_2' ||
          error.code === 'ER_NO_REFERENCED_ROW_2'

        if (benign) {
          applied += 1
          console.log(`  ~ ${head} (skipped: ${error.code})`)
          continue
        }

        console.error(`  ✗ ${head} → ${error.code || error.message}`)
        throw error
      }
    }

    console.log(`🌱 Seed completed: ${applied} statements applied`)
    return applied
  } finally {
    await conn.end()
  }
}

async function main() {
  try {
    await runMigrations()
    console.log('✅ Migrations completed. Run "npm run seed:admin" to create admin user.')
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { migrations }