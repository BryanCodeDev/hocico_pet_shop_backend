import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query, queryOne } from '../../src/config/database.js'

export const ROLE_IDS = {
  admin: 1,
  user: 2,
  guest: 3,
  cashier: 4,
}

export const DEFAULT_PASSWORD = 'Password123!'

let uniqueCounter = 0
function uniqueEmail(prefix = 'test') {
  uniqueCounter += 1
  return `${prefix}.${Date.now()}.${uniqueCounter}@hocico.test`
}

export async function createUser({
  role = 'user',
  email = uniqueEmail(role),
  password = DEFAULT_PASSWORD,
  firstName = 'Usuario',
  lastName = 'Prueba',
  isActive = true,
  ...rest
} = {}) {
  const passwordHash = await bcrypt.hash(password, 4)
  const result = await query(
    `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, is_active, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [ROLE_IDS[role], firstName, lastName, email, passwordHash, rest.phone ?? '3130000000', isActive]
  )
  return getUserById(result.insertId)
}

export async function getUserById(id) {
  return queryOne(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.deleted_at, r.name as role
     FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
    [id]
  )
}

export async function createCategory({
  name = 'Categoría Prueba',
  slug = `categoria-prueba-${Date.now()}`,
  parentId = null,
  isActive = true,
  sortOrder = 0,
} = {}) {
  const result = await query(
    `INSERT INTO categories (name, slug, parent_id, is_active, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [name, slug, parentId, isActive, sortOrder]
  )
  return queryOne('SELECT * FROM categories WHERE id = ?', [result.insertId])
}

export async function createProduct({
  categoryId,
  name = 'Producto Prueba',
  slug = `producto-prueba-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  sku = `SKU-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  barcode = null,
  price = 25000.0,
  originalPrice = null,
  stock = 10,
  minStock = 5,
  isActive = true,
  isFeatured = false,
  isOnSale = false,
  isNew = false,
} = {}) {
  let catId = categoryId
  if (!catId) {
    const category = await createCategory()
    catId = category.id
  }

  const result = await query(
    `INSERT INTO products
       (category_id, name, slug, sku, barcode, price, original_price, stock, min_stock, is_active, is_featured, is_on_sale, is_new)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [catId, name, slug, sku, barcode, price, originalPrice, stock, minStock, isActive, isFeatured, isOnSale, isNew]
  )
  return queryOne('SELECT * FROM products WHERE id = ?', [result.insertId])
}

export function tokenFor(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )
}

/** Cabecera Cookie lista para supertest: replica la cookie httpOnly real. */
export function authCookie(user) {
  return `token=${tokenFor(user)}`
}

/**
 * Crea un pedido directamente en base de datos, saltándose el endpoint.
 * Necesario para probar el webhook de pago, que solo necesita un pedido
 * existente en un estado concreto.
 */
export async function createOrder({
  userId = null,
  orderNumber = `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  status = 'pending',
  paymentStatus = 'pending',
  paymentMethod = 'wompi',
  channel = 'online',
  subtotal = 50000,
  discount = 0,
  shippingCost = 0,
  total = 50000,
  items = [],
} = {}) {
  const result = await query(
    `INSERT INTO orders (
       user_id, order_number, channel, status, payment_status, payment_method,
       subtotal, discount, shipping_cost, total, currency, external_reference,
       customer_name, customer_email, customer_phone, customer_document_type, customer_document_number,
       address, city, province
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COP', ?, ?, ?, ?, 'CC', '', ?, ?, ?)`,
    [
      userId,
      orderNumber,
      channel,
      status,
      paymentStatus,
      paymentMethod,
      subtotal,
      discount,
      shippingCost,
      total,
      orderNumber,
      'Cliente de Prueba',
      'cliente@hocico.test',
      '3130000000',
      'Calle 1 # 2-3',
      'Mosquera',
      'Cundinamarca',
    ]
  )

  const orderId = result.insertId

  for (const item of items) {
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, product_sku, product_slug, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, item.productId, item.name, item.sku, item.slug, item.quantity, item.unitPrice, item.unitPrice * item.quantity]
    )
  }

  return queryOne('SELECT * FROM orders WHERE id = ?', [orderId])
}

export async function getProductStock(productId) {
  const row = await queryOne('SELECT stock FROM products WHERE id = ?', [productId])
  return row ? row.stock : null
}

export async function countOrderItems(orderId) {
  const row = await queryOne('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', [orderId])
  return row ? Number(row.n) : 0
}

export async function countStockMovements(productId, type = null) {
  const row = await queryOne(
    'SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?' + (type ? ' AND type = ?' : ''),
    type ? [productId, type] : [productId]
  )
  return row ? Number(row.n) : 0
}
