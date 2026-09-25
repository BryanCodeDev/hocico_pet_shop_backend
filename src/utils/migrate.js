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

  // invoices se crea SIN el FK a orders (se agrega después con ALTER,
  // porque orders.invoice_id también referencia a invoices → dependencia cruzada)
  `CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    factus_id VARCHAR(100) NULL,
    invoice_number VARCHAR(50) NULL,
    cufe VARCHAR(255) NULL,
    status ENUM('pending','issued','error','cancelled') DEFAULT 'pending',
    xml_url VARCHAR(500) NULL,
    pdf_url VARCHAR(500) NULL,
    factus_response JSON NULL,
    error_message TEXT NULL,
    issued_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_invoices_order (order_id),
    INDEX idx_invoices_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    status ENUM('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_status ENUM('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'in_process', 'in_mediation', 'charged_back') DEFAULT 'pending',
    payment_method ENUM('wompi', 'whatsapp', 'bank_transfer', 'cash_on_delivery') NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0,
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'COP',
    customer_name VARCHAR(200) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    customer_document_type ENUM('CC','NIT','CE','PASSPORT') NOT NULL DEFAULT 'CC',
    customer_document_number VARCHAR(20) NOT NULL DEFAULT '',
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    notes TEXT,
    payment_id VARCHAR(100),
    invoice_id INT NULL,
    external_reference VARCHAR(100),
    paid_at TIMESTAMP NULL,
    shipped_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_order_number (order_number),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_payment_id (payment_id),
    INDEX idx_created (created_at),
    INDEX idx_external_ref (external_reference)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  // Ahora que orders existe, cerramos la dependencia cruzada en invoices
  `ALTER TABLE invoices
    ADD CONSTRAINT fk_invoices_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;`,

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
    reference VARCHAR(100) NULL,
    payment_method_id VARCHAR(100),
    payment_type VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    status_detail VARCHAR(100),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'COP',
    fee DECIMAL(12,2) DEFAULT 0,
    net_amount DECIMAL(12,2),
    payer_email VARCHAR(255),
    payer_id VARCHAR(100),
    external_reference VARCHAR(100),
    raw_data JSON,
    signature_checked BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_order (order_id),
    UNIQUE KEY uniq_payment_id (payment_id),
    UNIQUE KEY uniq_reference (reference),
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

  `CREATE TABLE IF NOT EXISTS shipping_zones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city VARCHAR(100) NOT NULL,
    cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS stock_movements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    type ENUM('in','out','adjustment') NOT NULL,
    quantity INT NOT NULL,
    reason VARCHAR(255) NULL,
    reference_type ENUM('order','manual','purchase') DEFAULT 'manual',
    reference_id INT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_product (product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  // ---- Seed mínimo embebido en la migración (roles, categorías, marcas, settings) ----
  // El resto de productos/usuario admin se maneja desde seed.sql (runSeed) para
  // no mezclar datos de catálogo dentro de la migración de esquema.

  `INSERT IGNORE INTO roles (id, name, description, permissions) VALUES
  (1, 'admin', 'Administrador completo', '{"all": true}'),
  (2, 'user', 'Usuario registrado', '{"orders": ["read", "create"], "profile": ["read", "update"], "cart": ["read", "create", "update", "delete"]}'),
  (3, 'guest', 'Usuario invitado', '{"cart": ["read", "create", "update", "delete"]}');`,

  `INSERT IGNORE INTO categories (id, name, slug, description, parent_id, sort_order, is_active) VALUES
  (1, 'Alimentos', 'alimentos', 'Alimento seco y húmedo para perros y gatos', NULL, 1, TRUE),
  (2, 'Alimento para Perro', 'alimento-perro', 'Concentrados y alimento húmedo para perros de todas las edades', 1, 1, TRUE),
  (3, 'Alimento para Gato', 'alimento-gato', 'Concentrados y alimento húmedo para gatos de todas las edades', 1, 2, TRUE),
  (4, 'Snacks', 'snacks', 'Premios, huesos y galletas para consentir a tu mascota', NULL, 2, TRUE),
  (5, 'Accesorios', 'accesorios', 'Correas, camas, comederos, transportadoras y más', NULL, 3, TRUE),
  (6, 'Higiene y Cuidado', 'higiene-cuidado', 'Shampoos, cepillos y productos de aseo', NULL, 4, TRUE);`,

  `INSERT IGNORE INTO brands (id, name, slug, description, is_active) VALUES
  (1, 'Hill''s', 'hills', 'Alimento científico premium para perros y gatos', TRUE),
  (2, 'Agility Gold', 'agility-gold', 'Alimento balanceado de alto rendimiento', TRUE),
  (3, 'Genérico', 'generico', 'Accesorios y productos varios sin marca específica', TRUE);`,

  `INSERT IGNORE INTO shipping_zones (city, cost) VALUES
  ('Mosquera', 0),
  ('Madrid', 5000),
  ('Funza', 5000);`,

  `INSERT IGNORE INTO settings (\`key\`, value, description) VALUES
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