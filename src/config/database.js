import mysql from 'mysql2/promise'
import 'dotenv/config'

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
})

const DB_CONNECTION = () => ({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
})

/**
 * En local la base se crea si no existe. En Railway la base YA existe y el
 * usuario de la aplicación no tiene permiso de CREATE DATABASE, así que el
 * `CREATE` a ciega devolvía ER_DBACCESS_DENIED_ERROR y tumbaba el arranque
 * aunque la conexión fuera correcta. Si falla por permisos, se sigue y se
 * comprueba después que la base sea realmente alcanzable.
 */
const SIN_PERMISO_CREATE = ['ER_DBACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR']

export async function ensureDatabase() {
  const dbName = process.env.DB_NAME || 'railway'
  const conn = await mysql.createConnection(DB_CONNECTION())

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\`
       CHARACTER SET utf8mb4
       COLLATE utf8mb4_unicode_ci`
    )
    console.log(`✅ Database "${dbName}" is ready.`)
  } catch (error) {
    if (!SIN_PERMISO_CREATE.includes(error.code)) throw error
    console.log(`ℹ️  Sin permiso de CREATE DATABASE; se asume que "${dbName}" ya existe.`)
  } finally {
    await conn.end()
  }

  // Comprobación definitiva: si la base no existe o las credenciales están
  // mal, falla aquí y el arranque se detiene con un error claro.
  const check = await mysql.createConnection({ ...DB_CONNECTION(), database: dbName })
  await check.end()
}

export async function connectDB() {
  try {
    const connection = await pool.getConnection()
    console.log('✅ MySQL connected successfully')
    connection.release()
    return pool
  } catch (error) {
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('❌ Database does not exist. Running ensureDatabase()...')
      await ensureDatabase()
      console.log('✅ Database created. Please restart the server.')
    }
    console.error('❌ MySQL connection failed:', error.message)
    throw error
  }
}

/**
 * Ejecuta una query.
 *
 * @param {string} sql
 * @param {Array} params
 * @param {object} [options]
 * @param {string[]} [options.silentCodes] - Códigos de error MySQL que NO
 *   deben imprimirse en consola (por ejemplo, errores "benignos" esperados
 *   como columnas/índices/FKs duplicados durante migraciones idempotentes).
 *   El error igual se relanza para que el caller decida qué hacer.
 */
export async function query(sql, params, options = {}) {
  const { silentCodes = [] } = options
  try {
    const [rows] = await pool.execute(sql, params)
    return rows
  } catch (error) {
    if (!silentCodes.includes(error.code)) {
      console.error('Query error:', error.message)
    }
    throw error
  }
}

export async function queryOne(sql, params) {
  const rows = await query(sql, params)
  return rows[0] || null
}

export async function transaction(callback) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await callback(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export default pool