import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'

export async function adminAdjustStock(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { productId, type, quantity, reason } = req.body
    const qty = Number(quantity)

    if (type === 'in' && qty <= 0) {
      return res.status(400).json({ error: 'Para entradas la cantidad debe ser positiva' })
    }

    const product = await queryOne(
      'SELECT id, name, stock FROM products WHERE id = ? AND deleted_at IS NULL',
      [productId]
    )
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const result = await transaction(async (conn) => {
      await conn.execute(
        'UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [qty, productId]
      )

      const [mov] = await conn.execute(
        `INSERT INTO stock_movements
          (product_id, type, quantity, reason, reference_type, reference_id, created_by)
         VALUES (?, ?, ?, ?, 'manual', NULL, ?)`,
        [productId, type, qty, reason || null, req.user.id]
      )

      const [updated] = await conn.execute(
        'SELECT stock, min_stock FROM products WHERE id = ?',
        [productId]
      )

      return { movementId: mov.insertId, stock: updated[0].stock }
    })

    res.json({
      message: 'Stock ajustado correctamente',
      movementId: result.movementId,
      productId,
      stock: result.stock,
      type,
      quantity: qty,
    })
  } catch (error) {
    console.error('Adjust stock error:', error)
    res.status(500).json({ error: 'Error al ajustar el stock' })
  }
}

export async function getStockHistory(req, res) {
  try {
    const { productId } = req.params

    const product = await queryOne(
      'SELECT id, name, sku, stock, min_stock FROM products WHERE id = ? AND deleted_at IS NULL',
      [productId]
    )
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const movements = await query(
      `SELECT sm.id, sm.type, sm.quantity, sm.reason, sm.reference_type, sm.reference_id,
              sm.created_at, u.first_name, u.last_name
       FROM stock_movements sm
       LEFT JOIN users u ON sm.created_by = u.id
       WHERE sm.product_id = ?
       ORDER BY sm.created_at DESC`,
      [productId]
    )

    res.json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        currentStock: product.stock,
        minStock: product.min_stock,
      },
      movements,
    })
  } catch (error) {
    console.error('Stock history error:', error)
    res.status(500).json({ error: 'Error al obtener el kardex del producto' })
  }
}
