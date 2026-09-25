import crypto from 'crypto'
import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'
import { generateOrderNumber, mapProduct } from '../utils/helpers.js'
import { createOrderCore, getOrderById } from './orderController.js'
import { triggerInvoiceGeneration } from './invoiceController.js'
import { getWompiConfig } from './paymentController.js'

function generateIntegritySignature(reference, amountInCents, currency) {
  const data = `${reference}${amountInCents}${currency}${process.env.WOMPI_INTEGRITY_SECRET}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

function parseCashReceivedNotes(notes) {
  if (!notes) return null
  const match = notes.match(/cash_received=([0-9.]+)/)
  return match ? parseFloat(match[1]) : null
}

async function getBusinessSettings() {
  const rows = await query(
    `SELECT \`key\`, value FROM settings WHERE \`key\` IN ('site_name', 'site_url', 'whatsapp_number', 'site_logo')`
  )
  const settings = {}
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      settings[row.key] = row.value
    }
  }
  return settings
}

async function fetchCashRegisterById(registerId, userId, role) {
  const register = await queryOne(
    `SELECT cr.*, u.first_name, u.last_name, u.email
     FROM cash_registers cr
     JOIN users u ON cr.user_id = u.id
     WHERE cr.id = ?`,
    [registerId]
  )

  if (!register) return null

  const isOwner = register.user_id === userId
  if (role !== 'admin' && !isOwner) return null

  const sales = await query(
    `SELECT o.id, o.order_number, o.total, o.payment_method, o.payment_status, o.created_at,
            o.customer_name, o.customer_document_type, o.customer_document_number
     FROM orders o
     WHERE o.cash_register_id = ?
     ORDER BY o.created_at DESC`,
    [registerId]
  )

  return {
    id: register.id,
    userId: register.user_id,
    userName: `${register.first_name} ${register.last_name}`,
    userEmail: register.email,
    openingAmount: parseFloat(register.opening_amount || 0),
    closingAmount: register.closing_amount ? parseFloat(register.closing_amount) : null,
    expectedAmount: register.expected_amount ? parseFloat(register.expected_amount) : null,
    difference: register.difference ? parseFloat(register.difference) : null,
    status: register.status,
    openedAt: register.opened_at,
    closedAt: register.closed_at,
    notes: register.notes,
    sales,
  }
}

export async function searchProductsForPos(req, res) {
  try {
    const { q } = req.query

    if (!q || q.trim().length < 1) {
      return res.json({ products: [] })
    }

    const trimmed = q.trim()

    const barcodeProduct = await queryOne(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.barcode = ? AND p.deleted_at IS NULL AND p.is_active = TRUE
       LIMIT 1`,
      [trimmed]
    )

    if (barcodeProduct) {
      return res.json({
        products: [{
          ...mapProduct(barcodeProduct),
          images: [],
        }],
        barcodeMatch: true,
      })
    }

    const products = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.deleted_at IS NULL AND p.is_active = TRUE
         AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)
       ORDER BY p.is_featured DESC, p.created_at DESC
       LIMIT 20`,
      [`%${trimmed}%`, `%${trimmed}%`, trimmed]
    )

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      }
    }))

    res.json({ products: productsWithImages, barcodeMatch: false })
  } catch (error) {
    console.error('Search products for POS error:', error)
    res.status(500).json({ error: 'Error en la búsqueda' })
  }
}

export async function getProductByBarcode(req, res) {
  try {
    const { barcode } = req.params

    const product = await queryOne(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.barcode = ? AND p.deleted_at IS NULL AND p.is_active = TRUE
       LIMIT 1`,
      [barcode]
    )

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado con ese código de barras' })
    }

    const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [product.id])

    res.json({
      product: {
        ...mapProduct(product),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      },
    })
  } catch (error) {
    console.error('Get product by barcode error:', error)
    res.status(500).json({ error: 'Error al buscar producto' })
  }
}

export async function createPosSale(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const {
      items,
      paymentMethod,
      cashReceived,
      customerDocumentType,
      customerDocumentNumber,
      customerName,
      customerEmail,
      customerPhone,
      notes,
    } = req.body
    const userId = req.user.id

    const openRegister = await queryOne(
      'SELECT id FROM cash_registers WHERE user_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [userId]
    )
    if (!openRegister) {
      return res.status(400).json({ error: 'Debes abrir caja antes de vender' })
    }

    if (paymentMethod === 'cash' && cashReceived !== undefined && cashReceived !== null) {
      const preCheck = await transaction(async (conn) => {
        let subtotal = 0
        let discount = 0
        for (const item of items) {
          const [rows] = await conn.execute(
            'SELECT id, name, price, original_price, stock FROM products WHERE id = ? AND deleted_at IS NULL AND is_active = TRUE FOR UPDATE',
            [item.productId]
          )
          const product = rows[0]
          if (!product) {
            throw new Error(`Producto ${item.productId} no encontrado`)
          }
          const qty = Number(item.quantity)
          if (product.stock < qty) {
            const error = new Error(`Stock insuficiente para ${product.name}`)
            error.code = 'STOCK_INSUFFICIENT'
            throw error
          }
          const unitPrice = Math.round(Number(product.price) * 100) / 100
          const originalPrice = Math.round(Number(product.original_price || 0) * 100) / 100
          const lineDiscount = originalPrice > unitPrice ? originalPrice - unitPrice : 0
          const itemSubtotal = Math.round(unitPrice * qty * 100) / 100
          subtotal = Math.round((subtotal + itemSubtotal) * 100) / 100
          discount = Math.round((discount + lineDiscount * qty) * 100) / 100
        }
        const total = Math.round((subtotal - discount) * 100) / 100
        return total
      })

      if (Number(cashReceived) < preCheck) {
        return res.status(400).json({
          error: `El monto recibido (${Number(cashReceived).toLocaleString('es-CO')}) es menor que el total (${preCheck.toLocaleString('es-CO')})`,
        })
      }
    }

    const orderNumber = generateOrderNumber()

    let notesValue = null
    if (paymentMethod === 'cash' && cashReceived !== undefined && cashReceived !== null) {
      notesValue = `POS: cash_received=${cashReceived}`
      if (notes) notesValue += `; ${notes}`
    } else if (notes) {
      notesValue = notes
    }

    const isWompi = paymentMethod === 'wompi'

    const result = await transaction(async (conn) => {
      return createOrderCore(conn, {
        items,
        shippingCost: 0,
        channel: 'pos',
        paymentMethod,
        status: isWompi ? 'pending' : 'paid',
        paymentStatus: isWompi ? 'pending' : 'approved',
        cashRegisterId: openRegister.id,
        paidAt: isWompi ? null : new Date(),
        customerName: customerName || 'Consumidor Final',
        customerEmail: customerEmail || '',
        customerPhone: customerPhone || req.user.phone || '',
        address: customerName ? (req.body.address || '') : '',
        city: customerName ? (req.body.city || '') : '',
        province: customerName ? (req.body.province || '') : '',
        notes: notesValue,
        customerDocumentType,
        customerDocumentNumber,
        userId,
        orderNumber,
      })
    })

    const order = await getOrderById(result.orderId, userId)

    if (isWompi) {
      const { publicKey, wompiEnv, currency } = await getWompiConfig({ currency: 'COP' })
      if (!publicKey || !process.env.WOMPI_INTEGRITY_SECRET) {
        return res.status(500).json({ error: 'Wompi no está configurado. Usa pago en efectivo.' })
      }

      const amountInCents = Math.round(Number(order.total || 0)) * 100
      const reference = order.order_number
      const integritySignature = generateIntegritySignature(reference, amountInCents, currency)

      await query(
        `INSERT INTO payments
          (order_id, payment_id, reference, payment_method_id, payment_type, status, amount, currency, external_reference, signature_checked)
         VALUES (?, ?, ?, 'wompi', 'wompi', 'pending', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = 'pending', updated_at = CURRENT_TIMESTAMP`,
        [order.id, reference, reference, order.total, currency, order.order_number]
      )

      const redirectUrl = `${process.env.FRONTEND_URL || ''}/admin/caja?paymentSuccess=${order.id}`

      return res.status(201).json({
        order,
        wompi: {
          publicKey,
          currency,
          amountInCents,
          reference,
          signature: integritySignature,
          integritySignature,
          environment: wompiEnv,
          redirectUrl,
          paymentMethod: 'wompi',
        },
      })
    }

    triggerInvoiceGeneration(result.orderId).catch((err) => {
      console.error(`Error generando factura para venta POS ${result.orderId}:`, err)
    })

    res.status(201).json({ order })
  } catch (error) {
    console.error('Create POS sale error:', error)
    if (error.code === 'STOCK_INSUFFICIENT') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: error.message || 'Error al crear venta POS' })
  }
}

export async function openCashRegister(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { openingAmount, notes } = req.body
    const userId = req.user.id

    const existing = await queryOne(
      'SELECT id FROM cash_registers WHERE user_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [userId]
    )
    if (existing) {
      return res.status(400).json({ error: 'Ya tienes una caja abierta' })
    }

    const result = await query(
      'INSERT INTO cash_registers (user_id, opening_amount, status, opened_at, notes) VALUES (?, ?, "open", NOW(), ?)',
      [userId, openingAmount, notes || null]
    )

    const register = await fetchCashRegisterById(result.insertId, userId, req.user.role)
    res.status(201).json({ cashRegister: register })
  } catch (error) {
    console.error('Open cash register error:', error)
    res.status(500).json({ error: 'Error al abrir caja' })
  }
}

export async function getCurrentCashRegister(req, res) {
  try {
    const userId = req.user.id
    const register = await queryOne(
      'SELECT id FROM cash_registers WHERE user_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [userId]
    )

    if (!register) {
      return res.json({ cashRegister: null })
    }

    const cashRegister = await fetchCashRegisterById(register.id, userId, req.user.role)
    res.json({ cashRegister })
  } catch (error) {
    console.error('Get current cash register error:', error)
    res.status(500).json({ error: 'Error al obtener caja' })
  }
}

export async function closeCashRegister(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { closingAmount, notes } = req.body
    const userId = req.user.id

    const register = await queryOne(
      'SELECT * FROM cash_registers WHERE user_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [userId]
    )
    if (!register) {
      return res.status(400).json({ error: 'No tienes una caja abierta' })
    }

    const cashSales = await queryOne(
      `SELECT COALESCE(SUM(total), 0) as total
       FROM orders
       WHERE cash_register_id = ? AND payment_method = 'cash' AND status = 'paid'`,
      [register.id]
    )
    const cardSales = await queryOne(
      `SELECT COALESCE(SUM(total), 0) as total
       FROM orders
       WHERE cash_register_id = ? AND payment_method = 'wompi' AND status = 'paid'`,
      [register.id]
    )

    const openingAmount = parseFloat(register.opening_amount || 0)
    const cashTotal = parseFloat(cashSales.total || 0)
    const cardTotal = parseFloat(cardSales.total || 0)
    const expectedAmount = Math.round((openingAmount + cashTotal) * 100) / 100
    const difference = Math.round((parseFloat(closingAmount) - expectedAmount) * 100) / 100

    let updatedNotes = register.notes || ''
    if (notes) {
      updatedNotes = updatedNotes ? `${updatedNotes}; ${notes}` : notes
    }
    if (!updatedNotes) {
      updatedNotes = null
    }

    await query(
      `UPDATE cash_registers
       SET closing_amount = ?, expected_amount = ?, difference = ?, status = "closed",
           closed_at = NOW(), notes = ?
       WHERE id = ?`,
      [closingAmount, expectedAmount, difference, updatedNotes, register.id]
    )

    const updatedRegister = await fetchCashRegisterById(register.id, userId, req.user.role)
    res.json({ cashRegister: updatedRegister })
  } catch (error) {
    console.error('Close cash register error:', error)
    res.status(500).json({ error: 'Error al cerrar caja' })
  }
}

export async function getCashRegisterById(req, res) {
  try {
    const { id } = req.params
    const userId = req.user.id
    const role = req.user.role

    const register = await fetchCashRegisterById(Number(id), userId, role)
    if (!register) {
      return res.status(404).json({ error: 'Caja no encontrada' })
    }

    res.json({ cashRegister: register })
  } catch (error) {
    console.error('Get cash register error:', error)
    res.status(500).json({ error: 'Error al obtener caja' })
  }
}

export async function getCashRegisterHistory(req, res) {
  try {
    const userId = req.user.id
    const role = req.user.role
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const offset = (page - 1) * limit

    let sql = `
      SELECT cr.*, u.first_name, u.last_name
      FROM cash_registers cr
      JOIN users u ON cr.user_id = u.id
      WHERE 1=1
    `
    const params = []

    if (role !== 'admin') {
      sql += ' AND cr.user_id = ?'
      params.push(userId)
    }

    const dateFrom = req.query.from
    const dateTo = req.query.to
    if (dateFrom) {
      sql += ' AND cr.opened_at >= ?'
      params.push(dateFrom)
    }
    if (dateTo) {
      sql += ' AND cr.opened_at <= ?'
      params.push(dateTo)
    }

    sql += ' ORDER BY cr.opened_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const countSql = sql.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/s, '')
    const countSqlFinal = `SELECT COUNT(*) as total FROM (${countSql}) as count_query`
    const countParams = params.slice(0, -2)

    const [registers, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSqlFinal, countParams),
    ])

    const formattedRegisters = registers.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: `${r.first_name} ${r.last_name}`,
      openingAmount: parseFloat(r.opening_amount || 0),
      closingAmount: r.closing_amount ? parseFloat(r.closing_amount) : null,
      expectedAmount: r.expected_amount ? parseFloat(r.expected_amount) : null,
      difference: r.difference !== null ? parseFloat(r.difference) : null,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      notes: r.notes,
    }))

    res.json({
      cashRegisters: formattedRegisters,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Get cash register history error:', error)
    res.status(500).json({ error: 'Error al obtener historial de cajas' })
  }
}

export async function getAllCashRegisters(req, res) {
  req.query.page = req.query.page || 1
  req.query.limit = req.query.limit || 50
  const page = parseInt(req.query.page)
  const limit = Math.min(parseInt(req.query.limit) || 50, 100)
  const offset = (page - 1) * limit

  let sql = `
    SELECT cr.*, u.first_name, u.last_name, u.email
    FROM cash_registers cr
    JOIN users u ON cr.user_id = u.id
    WHERE 1=1
  `
  const params = []

  const search = req.query.search
  if (search) {
    sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)'
    const term = `%${search}%`
    params.push(term, term, term)
  }

  const status = req.query.status
  if (status) {
    sql += ' AND cr.status = ?'
    params.push(status)
  }

  const dateFrom = req.query.from
  const dateTo = req.query.to
  if (dateFrom) {
    sql += ' AND cr.opened_at >= ?'
    params.push(dateFrom)
  }
  if (dateTo) {
    sql += ' AND cr.opened_at <= ?'
    params.push(dateTo)
  }

  sql += ' ORDER BY cr.opened_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const countSql = sql.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/s, '')
  const countSqlFinal = `SELECT COUNT(*) as total FROM (${countSql}) as count_query`
  const countParams = params.slice(0, -2)

  const [registers, countResult] = await Promise.all([
    query(sql, params),
    queryOne(countSqlFinal, countParams),
  ])

  const formattedRegisters = registers.map(r => ({
    id: r.id,
    userId: r.user_id,
    userName: `${r.first_name} ${r.last_name}`,
    userEmail: r.email,
    openingAmount: parseFloat(r.opening_amount || 0),
    closingAmount: r.closing_amount ? parseFloat(r.closing_amount) : null,
    expectedAmount: r.expected_amount ? parseFloat(r.expected_amount) : null,
    difference: r.difference !== null ? parseFloat(r.difference) : null,
    status: r.status,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    notes: r.notes,
  }))

  res.json({
    cashRegisters: formattedRegisters,
    pagination: {
      page,
      limit,
      total: countResult?.total || 0,
      totalPages: Math.ceil((countResult?.total || 0) / limit),
    },
  })
}

export async function getDailyReport(req, res) {
  try {
    const userId = req.user.id
    const dateFrom = req.query.date || new Date().toISOString().split('T')[0]

    const summary = await queryOne(
      `SELECT
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(*) as order_count,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'wompi' THEN total ELSE 0 END), 0) as card_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END), 0) as cash_count,
         COALESCE(SUM(CASE WHEN payment_method = 'wompi' THEN 1 ELSE 0 END), 0) as card_count
       FROM orders
       WHERE DATE(created_at) = DATE(?)
         AND user_id = ?
         AND channel = 'pos'`,
      [dateFrom, userId]
    )

    const openRegister = await queryOne(
      'SELECT opening_amount FROM cash_registers WHERE user_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [userId]
    )

    const ticketPromedio = summary.order_count > 0
      ? Math.round(parseFloat(summary.total_sales) / summary.order_count * 100) / 100
      : 0

    res.json({
      date: dateFrom,
      totalSales: parseFloat(summary.total_sales || 0),
      orderCount: summary.order_count || 0,
      ticketPromedio,
      byPaymentMethod: {
        cash: { total: parseFloat(summary.cash_sales || 0), count: summary.cash_count || 0 },
        card_pos: { total: parseFloat(summary.card_sales || 0), count: summary.card_count || 0 },
        wompi: { total: parseFloat(summary.card_sales || 0), count: summary.card_count || 0 },
      },
      currentRegister: openRegister
        ? { openingAmount: parseFloat(openRegister.opening_amount || 0) }
        : null,
    })
  } catch (error) {
    console.error('Get daily report error:', error)
    res.status(500).json({ error: 'Error al obtener reporte diario' })
  }
}

export async function getAdminDailyReport(req, res) {
  try {
    const dateFrom = req.query.date || new Date().toISOString().split('T')[0]

    const summary = await queryOne(
      `SELECT
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(*) as order_count,
         COALESCE(SUM(CASE WHEN channel = 'pos' THEN total ELSE 0 END), 0) as pos_sales,
         COALESCE(SUM(CASE WHEN channel = 'online' THEN total ELSE 0 END), 0) as online_sales,
         COALESCE(SUM(CASE WHEN channel = 'pos' THEN 1 ELSE 0 END), 0) as pos_count,
         COALESCE(SUM(CASE WHEN channel = 'online' THEN 1 ELSE 0 END), 0) as online_count,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'wompi' THEN total ELSE 0 END), 0) as wompi_sales,
         COALESCE(SUM(CASE WHEN payment_method = 'bank_transfer' THEN total ELSE 0 END), 0) as transfer_sales
       FROM orders
       WHERE DATE(created_at) = DATE(?)`,
      [dateFrom]
    )

    const ticketPromedio = summary.order_count > 0
      ? Math.round(parseFloat(summary.total_sales) / summary.order_count * 100) / 100
      : 0

    res.json({
      date: dateFrom,
      totalSales: parseFloat(summary.total_sales || 0),
      orderCount: summary.order_count || 0,
      ticketPromedio,
      byChannel: {
        pos: { total: parseFloat(summary.pos_sales || 0), count: summary.pos_count || 0 },
        online: { total: parseFloat(summary.online_sales || 0), count: summary.online_count || 0 },
      },
      byPaymentMethod: {
        cash: parseFloat(summary.cash_sales || 0),
        card_pos: 0,
        wompi: parseFloat(summary.wompi_sales || 0),
        bank_transfer: parseFloat(summary.transfer_sales || 0),
      },
    })
  } catch (error) {
    console.error('Get admin daily report error:', error)
    res.status(500).json({ error: 'Error al obtener reporte diario' })
  }
}

export async function getSalesByChannel(req, res) {
  try {
    const dateFrom = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const dateTo = req.query.to || new Date().toISOString().split('T')[0]

    const results = await query(
      `SELECT
         channel,
         COALESCE(SUM(total), 0) as total,
         COUNT(*) as count
       FROM orders
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY channel
       ORDER BY channel`,
      [dateFrom, dateTo]
    )

    const online = results.find(r => r.channel === 'online') || { total: 0, count: 0 }
    const pos = results.find(r => r.channel === 'pos') || { total: 0, count: 0 }

    res.json({
      period: { from: dateFrom, to: dateTo },
      online: { total: parseFloat(online.total || 0), count: online.count || 0 },
      pos: { total: parseFloat(pos.total || 0), count: pos.count || 0 },
    })
  } catch (error) {
    console.error('Get sales by channel error:', error)
    res.status(500).json({ error: 'Error al obtener ventas por canal' })
  }
}

export async function getSalesByPaymentMethod(req, res) {
  try {
    const dateFrom = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const dateTo = req.query.to || new Date().toISOString().split('T')[0]

    const results = await query(
      `SELECT
         payment_method,
         COALESCE(SUM(total), 0) as total,
         COUNT(*) as count
       FROM orders
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY payment_method
       ORDER BY total DESC`,
      [dateFrom, dateTo]
    )

    res.json({
      period: { from: dateFrom, to: dateTo },
      paymentMethods: results.map(r => ({
        method: r.payment_method,
        total: parseFloat(r.total || 0),
        count: r.count || 0,
      })),
    })
  } catch (error) {
    console.error('Get sales by payment method error:', error)
    res.status(500).json({ error: 'Error al obtener ventas por método de pago' })
  }
}

export async function getPosOrderReceipt(req, res) {
  try {
    const { id } = req.params
    const userId = req.user.id

    const order = await queryOne(
      `SELECT o.*, u.first_name, u.last_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.channel = 'pos'`,
      [id]
    )

    if (!order) {
      return res.status(404).json({ error: 'Venta POS no encontrada' })
    }

    const items = await query(
      `SELECT oi.*, (SELECT url FROM product_images WHERE product_id = oi.product_id AND is_main = TRUE LIMIT 1) as main_image
       FROM order_items oi
       WHERE oi.order_id = ?`,
      [order.id]
    )

    const invoice = order.invoice_id
      ? await queryOne(
          `SELECT factus_id, invoice_number, cufe, status, xml_url, pdf_url, error_message, issued_at
           FROM invoices WHERE id = ?`,
          [order.invoice_id]
        )
      : null

    const settings = await getBusinessSettings()
    const cashReceived = parseCashReceivedNotes(order.notes)
    const isCash = order.payment_method === 'cash'
    const change = isCash && cashReceived !== null
      ? Math.round((cashReceived - parseFloat(order.total)) * 100) / 100
      : 0

    res.json({
      business: {
        name: settings.site_name || 'Hocico Pet Shop',
        website: settings.site_url || '',
        phone: settings.whatsapp_number || '',
        logo: settings.site_logo || null,
      },
      order: {
        id: order.id,
        orderNumber: order.order_number,
        createdAt: order.created_at,
        channel: order.channel,
        paymentMethod: order.payment_method,
        subtotal: parseFloat(order.subtotal || 0),
        discount: parseFloat(order.discount || 0),
        shippingCost: parseFloat(order.shipping_cost || 0),
        total: parseFloat(order.total || 0),
        currency: order.currency,
        cashReceived: isCash ? cashReceived : null,
        change: isCash ? change : 0,
        customerName: order.customer_name,
        customerDocumentType: order.customer_document_type,
        customerDocumentNumber: order.customer_document_number,
      },
      items: items.map(item => ({
        productId: item.product_id,
        productName: item.product_name,
        sku: item.product_sku,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unit_price || 0),
        discountPrice: item.discount_price ? parseFloat(item.discount_price) : null,
        subtotal: parseFloat(item.subtotal || 0),
        image: item.main_image,
      })),
      invoice: invoice
        ? {
            id: invoice.id,
            factusId: invoice.factus_id,
            invoiceNumber: invoice.invoice_number,
            cufe: invoice.cufe,
            status: invoice.status,
            pdfUrl: invoice.pdf_url,
            xmlUrl: invoice.xml_url,
            errorMessage: invoice.error_message,
            issuedAt: invoice.issued_at,
          }
        : null,
    })
  } catch (error) {
    console.error('Get POS order receipt error:', error)
    res.status(500).json({ error: 'Error al obtener recibo' })
  }
}

export async function getPosReportsSummary(req, res) {
  try {
    const dateFrom = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const dateTo = req.query.to || new Date().toISOString().split('T')[0]
    const todayStart = new Date().toISOString().split('T')[0]

    const [summary, byChannel, byPaymentMethod, todayCashSales, recentCashRegisters] = await Promise.all([
      queryOne(
        `SELECT
           COALESCE(SUM(total), 0) as total_sales,
           COUNT(*) as order_count
         FROM orders
         WHERE created_at >= ? AND created_at <= ?`,
        [dateFrom, dateTo]
      ),
      query(
        `SELECT channel,
                COALESCE(SUM(total), 0) as total,
                COUNT(*) as count
         FROM orders
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY channel`,
        [dateFrom, dateTo]
      ),
      query(
        `SELECT payment_method,
                COALESCE(SUM(total), 0) as total,
                COUNT(*) as count
         FROM orders
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY payment_method`,
        [dateFrom, dateTo]
      ),
      queryOne(
        `SELECT
           COALESCE(SUM(total), 0) as today_cash_sales
         FROM orders
         WHERE DATE(created_at) = DATE(?)
           AND payment_method = 'cash'
           AND channel = 'pos'`,
        [todayStart]
      ),
      query(
        `SELECT cr.id, cr.user_id, cr.opening_amount, cr.closing_amount, cr.expected_amount,
                cr.difference, cr.status, cr.opened_at, cr.closed_at,
                u.first_name, u.last_name
         FROM cash_registers cr
         JOIN users u ON cr.user_id = u.id
         WHERE cr.opened_at >= ? AND cr.opened_at <= ?
         ORDER BY cr.opened_at DESC
         LIMIT 10`,
        [dateFrom, dateTo]
      ),
    ])

    const totalCount = summary.order_count || 0
    const totalSales = parseFloat(summary.total_sales || 0)
    const ticketPromedio = totalCount > 0 ? Math.round((totalSales / totalCount) * 100) / 100 : 0

    const online = byChannel.find(r => r.channel === 'online') || { total: 0, count: 0 }
    const pos = byChannel.find(r => r.channel === 'pos') || { total: 0, count: 0 }

    const recentRegisters = recentCashRegisters.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: `${r.first_name} ${r.last_name}`,
      openingAmount: parseFloat(r.opening_amount || 0),
      closingAmount: r.closing_amount ? parseFloat(r.closing_amount) : null,
      expectedAmount: r.expected_amount ? parseFloat(r.expected_amount) : null,
      difference: r.difference !== null ? parseFloat(r.difference) : null,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    }))

    res.json({
      period: { from: dateFrom, to: dateTo },
      summary: {
        totalSales,
        orderCount: totalCount,
        ticketPromedio,
      },
      byChannel: {
        online: { total: parseFloat(online.total || 0), count: online.count || 0 },
        pos: { total: parseFloat(pos.total || 0), count: pos.count || 0 },
      },
      byPaymentMethod: byPaymentMethod.map(r => ({
        method: r.payment_method,
        total: parseFloat(r.total || 0),
        count: r.count || 0,
      })),
      todayCashSales: parseFloat(todayCashSales?.today_cash_sales || 0),
      recentCashRegisters: recentRegisters,
    })
  } catch (error) {
    console.error('Get POS reports summary error:', error)
    res.status(500).json({ error: 'Error al obtener resumen de reportes' })
  }
}

export async function getCashRegistersReport(req, res) {
  try {
    const userId = req.user.id
    const role = req.user.role
    const dateFrom = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const dateTo = req.query.to || new Date().toISOString().split('T')[0]

    let sql = `
      SELECT cr.*, u.first_name, u.last_name, u.email
      FROM cash_registers cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.opened_at >= ? AND cr.opened_at <= ?
    `
    const params = [dateFrom, dateTo]

    if (role !== 'admin') {
      sql += ' AND cr.user_id = ?'
      params.push(userId)
    }

    sql += ' ORDER BY cr.opened_at DESC'

    const registers = await query(sql, params)

    let totalDifference = 0
    let closingCount = 0

    const results = registers.map(r => {
      const diff = r.difference !== null ? parseFloat(r.difference) : null
      if (diff !== null) {
        totalDifference = Math.round((totalDifference + diff) * 100) / 100
        closingCount++
      }
      return {
        id: r.id,
        userId: r.user_id,
        userName: `${r.first_name} ${r.last_name}`,
        userEmail: r.email,
        openingAmount: parseFloat(r.opening_amount || 0),
        closingAmount: r.closing_amount ? parseFloat(r.closing_amount) : null,
        expectedAmount: r.expected_amount ? parseFloat(r.expected_amount) : null,
        difference: diff,
        status: r.status,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        notes: r.notes,
      }
    })

    res.json({
      period: { from: dateFrom, to: dateTo },
      cashRegisters: results,
      summary: {
        totalCount: results.length,
        closedCount: closingCount,
        openCount: results.length - closingCount,
        totalDifference,
        averageDifference: closingCount > 0 ? Math.round((totalDifference / closingCount) * 100) / 100 : 0,
      },
    })
  } catch (error) {
    console.error('Get cash registers report error:', error)
    res.status(500).json({ error: 'Error al obtener reporte de cajas' })
  }
}

export async function getPosOrders(req, res) {
  try {
    const userId = req.user.id
    const role = req.user.role
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const offset = (page - 1) * limit
    const dateFrom = req.query.from
    const dateTo = req.query.to

    let sql = `
      SELECT o.*, u.first_name, u.last_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.channel = 'pos'
    `
    const params = []

    if (role !== 'admin') {
      sql += ' AND o.user_id = ?'
      params.push(userId)
    }

    if (dateFrom) {
      sql += ' AND DATE(o.created_at) >= DATE(?)'
      params.push(dateFrom)
    }
    if (dateTo) {
      sql += ' AND DATE(o.created_at) <= DATE(?)'
      params.push(dateTo)
    }

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const countSql = sql.replace(/ORDER BY.*$/s, '').replace(/LIMIT.*$/s, '')
    const countSqlFinal = `SELECT COUNT(*) as total FROM (${countSql}) as count_query`
    const countParams = params.slice(0, -2)

    const [orders, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSqlFinal, countParams),
    ])

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Get POS orders error:', error)
    res.status(500).json({ error: 'Error al obtener órdenes POS' })
  }
}