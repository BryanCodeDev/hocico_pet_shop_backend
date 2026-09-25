import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'

export async function getCart(req, res) {
  try {
    let items = []

    if (req.user) {
      const dbItems = await query(
        `SELECT ci.*, p.name, p.slug, p.sku, p.price, p.original_price, p.stock,
                (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as image
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         WHERE ci.user_id = ? AND p.deleted_at IS NULL`,
        [req.user.id]
      )
      items = dbItems
    } else {
      const sessionId = req.cookies?.cart_session || req.headers['x-cart-session']
      if (sessionId) {
        const dbItems = await query(
          `SELECT ci.*, p.name, p.slug, p.sku, p.price, p.original_price, p.stock,
                  (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as image
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           WHERE ci.session_id = ? AND p.deleted_at IS NULL`,
          [sessionId]
        )
        items = dbItems
      }
    }

    const formattedItems = items.map(item => ({
      productId: item.product_id,
      quantity: item.quantity,
      price: item.price,
      discountPrice: item.original_price && item.price < item.original_price ? item.price : null,
      name: item.name,
      slug: item.slug,
      sku: item.sku,
      image: item.image,
      stock: item.stock,
    }))

    const subtotal = formattedItems.reduce((sum, item) => sum + (item.discountPrice || item.price) * item.quantity, 0)
    const discount = formattedItems.reduce((sum, item) => sum + ((item.price - (item.discountPrice || item.price)) * item.quantity), 0)
    const total = subtotal

    res.json({ items: formattedItems, subtotal, discount, total, itemCount: formattedItems.reduce((sum, item) => sum + item.quantity, 0) })
  } catch (error) {
    console.error('Get cart error:', error)
    res.status(500).json({ error: 'Error al obtener carrito' })
  }
}

export async function addToCart(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { productId, quantity } = req.body
    const qty = parseInt(quantity) || 1

    const product = await queryOne('SELECT id, stock FROM products WHERE id = ? AND is_active = TRUE AND deleted_at IS NULL', [productId])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    if (product.stock < qty) {
      return res.status(400).json({ error: 'Stock insuficiente' })
    }

    if (req.user) {
      await transaction(async (conn) => {
        const existing = await conn.execute('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?', [req.user.id, productId])
        if (existing[0].length > 0) {
          const newQty = Math.min(existing[0][0].quantity + qty, product.stock)
          await conn.execute('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, existing[0][0].id])
        } else {
          await conn.execute('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)', [req.user.id, productId, qty])
        }
      })
    } else {
      let sessionId = req.cookies?.cart_session
      if (!sessionId) {
        sessionId = 'cart_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
        res.cookie('cart_session', sessionId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' })
      }

      await transaction(async (conn) => {
        const existing = await conn.execute('SELECT id, quantity FROM cart_items WHERE session_id = ? AND product_id = ?', [sessionId, productId])
        if (existing[0].length > 0) {
          const newQty = Math.min(existing[0][0].quantity + qty, product.stock)
          await conn.execute('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, existing[0][0].id])
        } else {
          await conn.execute('INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)', [sessionId, productId, qty])
        }
      })
    }

    res.json({ message: 'Producto agregado al carrito' })
  } catch (error) {
    console.error('Add to cart error:', error)
    res.status(500).json({ error: 'Error al agregar al carrito' })
  }
}

export async function updateCartItem(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { productId } = req.params
    const { quantity } = req.body
    const qty = parseInt(quantity)

    if (qty < 1) {
      return removeFromCart(req, res)
    }

    const product = await queryOne('SELECT stock FROM products WHERE id = ? AND deleted_at IS NULL', [productId])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    if (qty > product.stock) {
      return res.status(400).json({ error: 'Stock insuficiente' })
    }

    if (req.user) {
      await query('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND product_id = ?', [qty, req.user.id, productId])
    } else {
      const sessionId = req.cookies?.cart_session
      if (sessionId) {
        await query('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND product_id = ?', [qty, sessionId, productId])
      }
    }

    res.json({ message: 'Carrito actualizado' })
  } catch (error) {
    console.error('Update cart error:', error)
    res.status(500).json({ error: 'Error al actualizar carrito' })
  }
}

export async function removeFromCart(req, res) {
  try {
    const { productId } = req.params

    if (req.user) {
      await query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [req.user.id, productId])
    } else {
      const sessionId = req.cookies?.cart_session
      if (sessionId) {
        await query('DELETE FROM cart_items WHERE session_id = ? AND product_id = ?', [sessionId, productId])
      }
    }

    res.json({ message: 'Producto eliminado del carrito' })
  } catch (error) {
    console.error('Remove from cart error:', error)
    res.status(500).json({ error: 'Error al eliminar del carrito' })
  }
}

export async function clearCart(req, res) {
  try {
    if (req.user) {
      await query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id])
    } else {
      const sessionId = req.cookies?.cart_session
      if (sessionId) {
        await query('DELETE FROM cart_items WHERE session_id = ?', [sessionId])
      }
    }

    res.json({ message: 'Carrito vaciado' })
  } catch (error) {
    console.error('Clear cart error:', error)
    res.status(500).json({ error: 'Error al vaciar carrito' })
  }
}

export async function syncCart(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { items } = req.body
    if (!req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' })
    }

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id])
      for (const item of items) {
        const product = await conn.execute('SELECT stock FROM products WHERE id = ? AND is_active = TRUE AND deleted_at IS NULL', [item.productId])
        if (product[0].length > 0) {
          const qty = Math.min(item.quantity, product[0][0].stock)
          if (qty > 0) {
            await conn.execute('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)', [req.user.id, item.productId, qty])
          }
        }
      }
    })

    res.json({ message: 'Carrito sincronizado' })
  } catch (error) {
    console.error('Sync cart error:', error)
    res.status(500).json({ error: 'Error al sincronizar carrito' })
  }
}