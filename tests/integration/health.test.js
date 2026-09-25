import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

describe('GET /api/health', () => {
  it('responde 200 con el estado del servicio', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok' })
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('incluye un timestamp ISO 8601 parseable', async () => {
    const res = await request(app).get('/api/health')

    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false)
  })

  it('es accesible sin autenticación (lo usa el healthcheck de Railway)', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).not.toBe(401)
  })
})

describe('cabeceras de seguridad (helmet)', () => {
  it('aplica las cabeceras por defecto', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers).toHaveProperty('x-content-type-options')
    expect(res.headers).toHaveProperty('x-frame-options')
    expect(res.headers).toHaveProperty('x-dns-prefetch-control')
  })
})

describe('CORS', () => {
  it('responde al preflight con los métodos y cabeceras permitidos', async () => {
    const res = await request(app)
      .options('/api/products')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')

    expect(res.status).toBeLessThan(300)
    expect(res.headers['access-control-allow-methods']).toContain('POST')
  })

  it('permite credenciales (la app usa cookie httpOnly de sesión)', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')

    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })
})

describe('rutas inexistentes', () => {
  it('responde 404 con cuerpo JSON en vez de HTML', async () => {
    const res = await request(app).get('/api/no-existe')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('no filtra stack traces ni rutas internas del servidor', async () => {
    const res = await request(app).get('/api/no-existe')
    const body = JSON.stringify(res.body)

    expect(body).not.toMatch(/node_modules|at Object|\.js:\d+/)
  })
})

// Ver tests/integration/error-handling.test.js para el manejo de errores y
// el límite de tamaño del cuerpo.
