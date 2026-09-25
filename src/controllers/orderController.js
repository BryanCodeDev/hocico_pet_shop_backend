import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'
import { generateOrderNumber } from '../utils/helpers.js'

const ORDER_STATUSES = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded']

export async function createOrder(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { customerName, customerEmail, customerPhone, address, city, province, notes, items, paymentMethod } = req.body
    const userId = req.user?.id || null
    const orderNumber = generateOrderNumber()

    const orderId = await transaction(async (conn) => {
      let subtotal = 0
      let discount = 0

      for (const item of items) {
        const quantity = Number(item.quantity)
        const [productRows] = await conn.execute(
          `SELECT id, name, price, original_price, sku, slug, stock
           FROM products
           WHERE id = ? AND deleted_at IS NULL
           FOR UPDATE`,
          [item.productId]
        )
        const product = productRows[0]

        if (!product) {
          throw new Error(`Producto ${item.productId} no encontrado`)
        }

        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error(`Cantidad inválida para el producto ${item.productId}`)
        }

        if (product.stock < quantity) {
          const error = new Error(`Stock insuficiente para ${product.name}`)
          error.code = 'STOCK_INSUFFICIENT'
          throw error
        }

        const unitPrice = Math.round(Number(product.price) * 100) / 100
        const originalPrice = Math.round(Number(product.original_price || 0) * 100) / 100
        const lineDiscount = originalPrice > unitPrice ? originalPrice - unitPrice : 0
        const itemSubtotal = Math.round(unitPrice * quantity * 100) / 100

        subtotal = Math.round((subtotal + itemSubtotal) * 100) / 100
        discount = Math.round((discount + lineDiscount * quantity) * 100) / 100

        await conn.execute(
          `INSERT INTO order_items (order_id, product_id, product_name, product_sku, product_slug, quantity, unit_price, discount_price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            0,
            product.id,
            product.name,
            product.sku,
            product.slug,
            quantity,
            unitPrice,
            lineDiscount > 0 ? unitPrice : null,
            itemSubtotal,
          ]
        )

        await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, product.id])
      }

      const total = subtotal
      const [orderResult] = await conn.execute(
        `INSERT INTO orders (
          user_id, order_number, status, payment_status, payment_method,
          subtotal, discount, shipping_cost, total, currency, external_reference,
          customer_name, customer_email, customer_phone, address, city, province, notes
        ) VALUES (?, ?, 'pending', 'pending', ?, ?, ?, 0, ?, 'COP', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          orderNumber,
          paymentMethod,
          subtotal,
          discount,
          total,
          orderNumber,
          customerName,
          customerEmail,
          customerPhone,
          address,
          city,
          province,
          notes || null,
        ]
      )

      const createdOrderId = orderResult.insertId

      for (const item of items) {
        await conn.execute(
          `UPDATE order_items SET order_id = ?
           WHERE order_id = 0
             AND product_id = ?
             AND product_sku = ?
           LIMIT 1`,
          [createdOrderId, item.productId, item.sku]
        )
      }

      await conn.execute(
        `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
         VALUES (?, 'pending', NULL, ?, 'Pedido creado')`,
        [createdOrderId, userId]
      )

      return createdOrderId
    })

    const order = await getOrderById(orderId, userId)
    res.status(201).json({ order })
  } catch (error) {
    console.error('Create order error:', error)
    if (error.code === 'STOCK_INSUFFICIENT') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: error.message || 'Error al crear pedido' })
  }
}

async function getOrderById(orderId, userId = null) {
  let sql = `
    SELECT o.*, u.first_name, u.last_name
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `
  const params = [orderId]

  if (userId) {
    sql += ' AND (o.user_id = ? OR ? IS NULL)'
    params.push(userId, userId)
  }

  const order = await queryOne(sql, params)
  if (!order) return null

  const items = await query(
    `SELECT oi.*, p.slug, p.images FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ?`,
    [orderId]
  )

  const history = await query(
    `SELECT osh.*, u.first_name, u.last_name FROM order_status_history osh
     LEFT JOIN users u ON osh.changed_by = u.id
     WHERE osh.order_id = ? ORDER BY osh.created_at DESC`,
    [orderId]
  )

  return { ...order, items, history }
}

export async function getMyOrders(req, res) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 10, 50)
    const status = req.query.status
    const offset = (page - 1) * limit

    let sql = `
      SELECT o.*, 
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count
      FROM orders o
      WHERE o.user_id = ?
    `
    const params = [req.user.id]

    if (status && ORDER_STATUSES.includes(status)) {
      sql += ' AND o.status = ?'
      params.push(status)
    }

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const countSql = sql.replace('SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count', 'SELECT COUNT(*) as total').replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '')

    const [orders, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSql, params.slice(0, -2)),
    ])

    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const items = await query(
        `SELECT oi.*, (SELECT url FROM product_images WHERE product_id = oi.product_id AND is_main = TRUE LIMIT 1) as main_image
         FROM order_items oi WHERE oi.order_id = ?`,
        [order.id]
      )
      return { ...order, items }
    }))

    res.json({
      orders: ordersWithItems,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Get my orders error:', error)
    res.status(500).json({ error: 'Error al obtener pedidos' })
  }
}

export async function getOrderByIdPublic(req, res) {
  try {
    const { id } = req.params
    const order = await getOrderById(id, req.user.id)
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }
    res.json({ order })
  } catch (error) {
    console.error('Get order error:', error)
    res.status(500).json({ error: 'Error al obtener pedido' })
  }
}

export async function getOrderByNumber(req, res) {
  try {
    const { orderNumber } = req.params

    let sql = `
      SELECT o.*, u.first_name, u.last_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.order_number = ?
    `
    const params = [orderNumber]

    if (req.user) {
      sql += ' AND (o.user_id = ? OR ? IS NULL)'
      params.push(req.user.id, req.user.id)
    }

    const order = await queryOne(sql, params)
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }

    const items = await query(
      `SELECT oi.*, (SELECT url FROM product_images WHERE product_id = oi.product_id AND is_main = TRUE LIMIT 1) as main_image
       FROM order_items oi WHERE oi.order_id = ?`,
      [order.id]
    )

    const history = await query(
      `SELECT osh.*, u.first_name, u.last_name FROM order_status_history osh
       LEFT JOIN users u ON osh.changed_by = u.id
       WHERE osh.order_id = ? ORDER BY osh.created_at DESC`,
      [order.id]
    )

    res.json({ order: { ...order, items, history } })
  } catch (error) {
    console.error('Get order by number error:', error)
    res.status(500).json({ error: 'Error al obtener pedido' })
  }
}

export async function adminGetOrders(req, res) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const status = req.query.status
    const paymentStatus = req.query.paymentStatus
    const search = req.query.search
    const dateFrom = req.query.dateFrom
    const dateTo = req.query.dateTo
    const offset = (page - 1) * limit

    let sql = `
      SELECT o.*, u.email, u.first_name, u.last_name,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `
    const params = []

    if (status && ORDER_STATUSES.includes(status)) {
      sql += ' AND o.status = ?'
      params.push(status)
    }
    if (paymentStatus) {
      sql += ' AND o.payment_status = ?'
      params.push(paymentStatus)
    }
    if (search) {
      sql += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)'
      const term = `%${search}%`
      params.push(term, term, term)
    }
    if (dateFrom) {
      sql += ' AND o.created_at >= ?'
      params.push(dateFrom)
    }
    if (dateTo) {
      sql += ' AND o.created_at <= ?'
      params.push(dateTo)
    }

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const countSql = sql.replace(
      'SELECT o.*, u.email, u.first_name, u.last_name, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count',
      'SELECT COUNT(*) as total'
    ).replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '')

    const [orders, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSql, params.slice(0, -2)),
    ])

    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const items = await query(
        `SELECT oi.*, (SELECT url FROM product_images WHERE product_id = oi.product_id AND is_main = TRUE LIMIT 1) as main_image
         FROM order_items oi WHERE oi.order_id = ?`,
        [order.id]
      )
      return { ...order, items }
    }))

    res.json({
      orders: ordersWithItems,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Admin get orders error:', error)
    res.status(500).json({ error: 'Error al obtener pedidos' })
  }
}

export async function adminGetOrderById(req, res) {
  try {
    const { id } = req.params
    const order = await getOrderById(id)
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }
    res.json({ order })
  } catch (error) {
    console.error('Admin get order error:', error)
    res.status(500).json({ error: 'Error al obtener pedido' })
  }
}

export async function adminUpdateOrderStatus(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { id } = req.params
    const { status } = req.body

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' })
    }

    const order = await queryOne('SELECT id, status FROM orders WHERE id = ?', [id])
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }

    await transaction(async (conn) => {
      await conn.execute('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id])
      await conn.execute(
        `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [id, status, order.status, req.user.id, `Estado cambiado a ${status} por administrador`]
      )

      if (status === 'shipped') {
        await conn.execute('UPDATE orders SET shipped_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
      } else if (status === 'delivered') {
        await conn.execute('UPDATE orders SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
      } else if (status === 'cancelled') {
        await conn.execute('UPDATE orders SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
        // Restore stock
        const items = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id])
        for (const item of items[0]) {
          await conn.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id])
        }
      } else if (status === 'refunded') {
        await conn.execute('UPDATE orders SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
      }
    })

    const updatedOrder = await getOrderById(id)
    res.json({ order: updatedOrder })
  } catch (error) {
    console.error('Admin update order status error:', error)
    res.status(500).json({ error: 'Error al actualizar estado' })
  }
}

export async function adminGetOrderHistory(req, res) {
  try {
    const { id } = req.params
    const history = await query(
      `SELECT osh.*, u.first_name, u.last_name FROM order_status_history osh
       LEFT JOIN users u ON osh.changed_by = u.id
       WHERE osh.order_id = ? ORDER BY osh.created_at DESC`,
      [id]
    )
    res.json({ history })
  } catch (error) {
    console.error('Admin get order history error:', error)
    res.status(500).json({ error: 'Error al obtener historial' })
  }
}