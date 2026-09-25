import { transaction } from '../../src/config/database.js'

/**
 * Tablas que se vacían entre suites. Se conservan `roles` y `settings`
 * (los siembra runSeed y son catálogo de referencia) y `shipping_zones`.
 */
export const TEST_TABLES = [
  'product_images',
  'cart_items',
  'order_items',
  'order_status_history',
  'payments',
  'invoices',
  'stock_movements',
  'orders',
  'reviews',
  'cash_registers',
  'products',
  'categories',
  'brands',
  'users',
]

/**
 * Deja las tablas de negocio vacías y resetea los AUTO_INCREMENT.
 * Usa `transaction()` a propósito: `SET FOREIGN_KEY_CHECKS` es de sesión,
 * y el pool tiene varias conexiones, así que con `query()` el SET solo
 * aplicaría a una de ellas y el TRUNCATE fallaría por claves foráneas.
 */
export async function resetDatabase() {
  await transaction(async (conn) => {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of TEST_TABLES) {
      await conn.query(`TRUNCATE TABLE \`${table}\``)
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  })
}
