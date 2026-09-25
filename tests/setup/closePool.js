import { afterAll } from 'vitest'

// mysql2 mantiene el pool de conexiones abierto. Sin cerrarlo, el proceso de
// Vitest no termina y la corrida queda colgada con el "hanging-process".
// `pool` es el export por defecto de src/config/database.js.
afterAll(async () => {
  const { default: pool } = await import('../../src/config/database.js')
  await pool.end()
})
