import { query, queryOne } from '../config/database.js'

export async function getDashboardStats(req, res) {
  try {
    const [
      totalSales,
      todaySales,
      monthSales,
      totalOrders,
      pendingOrders,
      totalProducts,
      totalUsers,
      lowStockCount,
    ] = await Promise.all([
      queryOne('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE payment_status = "approved"'),
      queryOne('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE payment_status = "approved" AND DATE(paid_at) = CURDATE()'),
      queryOne('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE payment_status = "approved" AND MONTH(paid_at) = MONTH(CURDATE()) AND YEAR(paid_at) = YEAR(CURDATE())'),
      queryOne('SELECT COUNT(*) as total FROM orders'),
      queryOne('SELECT COUNT(*) as total FROM orders WHERE status = "pending"'),
      queryOne('SELECT COUNT(*) as total FROM products WHERE deleted_at IS NULL'),
      queryOne('SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL'),
      queryOne('SELECT COUNT(*) as total FROM products WHERE stock <= min_stock AND stock > 0 AND deleted_at IS NULL'),
    ])

    res.json({
      stats: {
        totalSales: parseFloat(totalSales?.total || 0),
        todaySales: parseFloat(todaySales?.total || 0),
        monthSales: parseFloat(monthSales?.total || 0),
        totalOrders: totalOrders?.total || 0,
        pendingOrders: pendingOrders?.total || 0,
        totalProducts: totalProducts?.total || 0,
        totalUsers: totalUsers?.total || 0,
        lowStockCount: lowStockCount?.total || 0,
      },
    })
  } catch (error) {
    console.error('Get dashboard stats error:', error)
    res.status(500).json({ error: 'Error al obtener estadísticas' })
  }
}

export async function getSalesChart(req, res) {
  try {
    const days = parseInt(req.query.days) || 30
    const sales = await query(
      `SELECT DATE(paid_at) as date, COALESCE(SUM(total), 0) as total, COUNT(*) as count
       FROM orders
       WHERE payment_status = "approved" AND paid_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(paid_at)
       ORDER BY date ASC`,
      [days]
    )

    const labels = []
    const data = []
    const counts = []

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      labels.push(date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }))

      const found = sales.find(s => s.date === dateStr)
      data.push(parseFloat(found?.total || 0))
      counts.push(found?.count || 0)
    }

    res.json({ labels, data, counts })
  } catch (error) {
    console.error('Get sales chart error:', error)
    res.status(500).json({ error: 'Error al obtener gráfica de ventas' })
  }
}

export async function getOrdersChart(req, res) {
  try {
    const days = parseInt(req.query.days) || 30
    const orders = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
       FROM orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    )

    const labels = []
    const total = []
    const pending = []
    const paid = []
    const cancelled = []

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      labels.push(date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }))

      const found = orders.find(o => o.date === dateStr)
      total.push(found?.total || 0)
      pending.push(found?.pending || 0)
      paid.push(found?.paid || 0)
      cancelled.push(found?.cancelled || 0)
    }

    res.json({ labels, total, pending, paid, cancelled })
  } catch (error) {
    console.error('Get orders chart error:', error)
    res.status(500).json({ error: 'Error al obtener gráfica de pedidos' })
  }
}

export async function getTopProducts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 10
    const products = await query(
      `SELECT p.id, p.name, p.sku, p.price, p.stock,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as image,
              SUM(oi.quantity) as total_sold,
              SUM(oi.subtotal) as revenue
       FROM products p
       JOIN order_items oi ON p.id = oi.product_id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.payment_status = "approved" AND p.deleted_at IS NULL
       GROUP BY p.id, p.name, p.sku, p.price, p.stock
       ORDER BY total_sold DESC
       LIMIT ?`,
      [limit]
    )

    res.json({ products })
  } catch (error) {
    console.error('Get top products error:', error)
    res.status(500).json({ error: 'Error al obtener productos más vendidos' })
  }
}

export async function getLowStockProducts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 10
    const products = await query(
      `SELECT p.id, p.name, p.sku, p.price, p.stock, p.min_stock,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as image,
              c.name as category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.stock <= p.min_stock AND p.stock > 0 AND p.deleted_at IS NULL
       ORDER BY p.stock ASC
       LIMIT ?`,
      [limit]
    )

    res.json({ products })
  } catch (error) {
    console.error('Get low stock error:', error)
    res.status(500).json({ error: 'Error al obtener productos con stock bajo' })
  }
}