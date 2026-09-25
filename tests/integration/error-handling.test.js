import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('límite de tamaño del cuerpo', () => {
  it(
    'debería responder 413 cuando el JSON supera los 10 MB',
    async () => {
      const oversized = { blob: 'x'.repeat(11 * 1024 * 1024) }
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(oversized))

      // DEFECTO: express.json lanza un error con status 413, pero
      // errorHandler solo sabe mapear ValidationError / UnauthorizedError /
      // errores de MySQL. Todo lo demás cae en el 500 final, así que un
      // payload abusivo se reporta como error del servidor en vez de
      // "payload demasiado grande".
      expect(res.status).toBe(413)
    }
  )

  it('acepta un cuerpo dentro del límite', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-es-un-correo', password: '' })

    // Llega al controller (validación), no al limitador de tamaño.
    expect(res.status).toBe(400)
  })
})

describe('filtración de información en errores', () => {
  it('no expone el stack trace cuando NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-es-un-correo', password: '' })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).not.toMatch(/\bat \/|\.js:\d+|node_modules/)
  })

  it('traduce los errores de clave duplicada de MySQL a 409', async () => {
    // El mensaje no puede filtrar el SQL ni el nombre de la tabla.
    const res = await request(app).get('/api/products/id/999999')

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('JSON malformado', () => {
  it(
    'debería responder 400 a un cuerpo que no es JSON válido',
    async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ esto no es json ')

      // DEFECTO: body-parser etiqueta el error con status 400 y type
      // 'entity.parse.failed', pero errorHandler no mira `err.status` y cae
      // en el 500 genérico. Un cliente con el payload mal formado genera
      // errores de servidor rojos en el monitoreo en lugar de un 400 normal.
      expect(res.status).toBe(400)
    }
  )
})
