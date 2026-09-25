import path from 'node:path'
import dotenv from 'dotenv'

// El orden importa: primero .env (credenciales reales de MySQL local), luego
// el override que aisla la base de datos. dotenv no pisa variables ya definidas.
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

process.env.NODE_ENV = 'test'
process.env.DB_NAME = `${process.env.DB_NAME || 'hocico_pet_shop'}_test`
process.env.RATE_LIMIT_MAX = '1000000'
process.env.RATE_LIMIT_WINDOW_MS = '60000'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-de-pruebas-no-usar-en-produccion'

const { ensureDatabase } = await import('../../src/config/database.js')
const { runMigrations, runSeed } = await import('../../src/utils/migrate.js')

export default async function setup() {
  await ensureDatabase()
  await runMigrations()
  await runSeed()
  console.log(`\n🧪 Base de datos de pruebas lista: ${process.env.DB_NAME}\n`)
}

export async function teardown() {
  const { default: pool } = await import('../../src/config/database.js')
  await pool.end()
}
