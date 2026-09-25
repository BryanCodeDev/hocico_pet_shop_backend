import { Router } from 'express'
import { query } from '../config/database.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const zones = await query(
      `SELECT id, city, cost, is_active AS isActive, created_at
       FROM shipping_zones
       WHERE is_active = TRUE
       ORDER BY city`
    )
    res.json({ zones })
  } catch (error) {
    console.error('Shipping zones error:', error)
    res.status(500).json({ error: 'Error al obtener zonas de envío' })
  }
})

export default router
