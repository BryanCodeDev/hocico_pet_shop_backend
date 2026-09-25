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

export async function ensureDatabase() {
  const dbName = process.env.DB_NAME || 'railway'
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
  })

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\`
       CHARACTER SET utf8mb4
       COLLATE utf8mb4_unicode_ci`
    )
    console.log(`✅ Database "${dbName}" is ready.`)
  } finally {
    await conn.end()
  }
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

export async function query(sql, params) {
  try {
    const [rows] = await pool.execute(sql, params)
    return rows
  } catch (error) {
    console.error('Query error:', error)
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
