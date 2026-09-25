import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../../src/app.js'
import { query } from '../../src/config/database.js'
import { resetDatabase } from '../helpers/db.js'
import { createUser, authCookie } from '../helpers/factories.js'

/**
 * Matriz rol × endpoint sobre la gestión de usuarios.
 *
 * Hay DOS superficies equivalentes y ambas están vivas:
 *   - /api/users/*        → routes/users.js  (legado, SIN authorize)
 *   - /api/admin/users/*  → routes/admin.js  (protegida con router.use)
 *
 * `/api/admin/users` es la referencia del comportamiento correcto.
 * `/api/users` es un duplicado sinorical que debe comportarse igual.
 */

let admin
let user
let cashier
let otherUser

beforeEach(async () => {
  await resetDatabase()
  // resetDatabase() vacía users, así que los fixtures se recrean en cada prueba.
  admin = await createUser({ role: 'admin' })
  cashier = await createUser({ role: 'cashier' })
  user = await createUser({ role: 'user' })
  otherUser = await createUser({ role: 'user' })
})

describe('autenticación', () => {
  it('rechaza la petición sin token con 401', async () => {
    const res = await request(app).get('/api/users')
    expect(res.status).toBe(401)
  })

  it('rechaza un token con firma inválida con 401', async () => {
    const forged = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, 'clave-falsa')
    const res = await request(app).get('/api/users').set('Cookie', `token=${forged}`)
    expect(res.status).toBe(401)
  })

  it('rechaza un token expirado con 401', async () => {
    const expired = jwt.sign(
      { id: user.id, email: user.email, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    )
    const res = await request(app).get('/api/users').set('Cookie', `token=${expired}`)
    expect(res.status).toBe(401)
  })

  it('rechaza con 401 a un usuario desactivado aunque su token siga vigente', async () => {
    const target = await createUser({ role: 'user' })
    await query('UPDATE users SET is_active = FALSE WHERE id = ?', [target.id])

    const res = await request(app).get('/api/users').set('Cookie', authCookie(target))

    expect(res.status).toBe(401)
  })

  it('acepta el token por cabecera Authorization: Bearer', async () => {
    const token = authCookie(admin).replace('token=', '')
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('no acepta el Bearer de un usuario sin permisos de administración', async () => {
    // El mismo token por cabecera, pero de un cliente normal: el rol se
    // comprueba igual venga la cookie o venga el Bearer.
    const token = authCookie(user).replace('token=', '')
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/users — control de acceso (RUTA LEGADO)', () => {
  it(
    'debería devolver 403 a un usuario normal (permisos insuficientes)',
    async () => {
      const res = await request(app).get('/api/users').set('Cookie', authCookie(user))

      // BUG P0 — routes/users.js:8 declara `authenticate` pero no
      // `authorize('admin')`, así que cualquier usuario autenticado (incluso
      // un cliente de la tienda) obtiene el listado completo de cuentas:
      // nombre, email, teléfono, dirección y ciudad de todos los clientes.
      // La misma operación en /api/admin/users sí exige admin.
      expect(res.status).toBe(403)
    }
  )

  it(
    'debería devolver 403 a un cajero',
    async () => {
      const res = await request(app).get('/api/users').set('Cookie', authCookie(cashier))
      expect(res.status).toBe(403)
    }
  )

  it('permite el listado a un administrador', async () => {
    const res = await request(app).get('/api/users').set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('users')
    expect(Array.isArray(res.body.users)).toBe(true)
  })

  it('nunca incluye el hash de la contraseña en la respuesta', async () => {
    const res = await request(app).get('/api/users').set('Cookie', authCookie(admin))

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toMatch(/password_hash|passwordHash|\$2[aby]\$/)
  })
})

describe('GET /api/users/:id — aislamiento entre cuentas', () => {
  it('impide que un usuario vea el detalle de otro', async () => {
    const res = await request(app)
      .get(`/api/users/${otherUser.id}`)
      .set('Cookie', authCookie(user))

    expect(res.status).toBe(403)
  })

  it('permite a un usuario ver su propio detalle', async () => {
    const res = await request(app)
      .get(`/api/users/${user.id}`)
      .set('Cookie', authCookie(user))

    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(user.id)
    expect(res.body.user).toHaveProperty('orderCount', 0)
  })

  it('devuelve 404 para un usuario inexistente consultado por un admin', async () => {
    const res = await request(app).get('/api/users/999999').set('Cookie', authCookie(admin))
    expect(res.status).toBe(404)
  })
})

describe('escrituras sobre usuarios — solo admin', () => {
  it('PUT /api/users/:id exige rol admin', async () => {
    const res = await request(app)
      .put(`/api/users/${otherUser.id}`)
      .set('Cookie', authCookie(user))
      .send({ firstName: 'Intruso', lastName: 'X', email: otherUser.email })

    expect(res.status).toBe(403)
  })

  it('PATCH /api/users/:id/status exige rol admin', async () => {
    const res = await request(app)
      .patch(`/api/users/${otherUser.id}/status`)
      .set('Cookie', authCookie(cashier))

    expect(res.status).toBe(403)
  })

  it('PATCH /api/users/:id/role exige rol admin', async () => {
    const res = await request(app)
      .patch(`/api/users/${otherUser.id}/role`)
      .set('Cookie', authCookie(user))
      .send({ role: 'admin' })

    expect(res.status).toBe(403)
  })

  it('impide que un usuario se auto-eleve a admin', async () => {
    const res = await request(app)
      .patch(`/api/users/${user.id}/role`)
      .set('Cookie', authCookie(user))
      .send({ role: 'admin' })

    expect(res.status).toBe(403)
  })
})

describe('reglas de negocio de la gestión de usuarios (como admin)', () => {
  it('un admin no puede desactivar su propia cuenta', async () => {
    const res = await request(app)
      .patch(`/api/users/${admin.id}/status`)
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(400)
  })

  it('un admin no puede cambiar su propio rol', async () => {
    const res = await request(app)
      .patch(`/api/users/${admin.id}/role`)
      .set('Cookie', authCookie(admin))
      .send({ role: 'user' })

    expect(res.status).toBe(400)
  })

  it('rechaza un rol fuera del catálogo permitido', async () => {
    const res = await request(app)
      .patch(`/api/users/${otherUser.id}/role`)
      .set('Cookie', authCookie(admin))
      .send({ role: 'superusuario' })

    expect(res.status).toBe(400)
  })

  it('rechaza un id no numérico en la ruta', async () => {
    const res = await request(app).get('/api/users/no-es-un-id').set('Cookie', authCookie(admin))

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('acota el tamaño de página', async () => {
    const res = await request(app)
      .get('/api/users?limit=5000')
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(400)
  })

  it('rechaza un email duplicado al actualizar', async () => {
    const res = await request(app)
      .put(`/api/users/${otherUser.id}`)
      .set('Cookie', authCookie(admin))
      .send({
        firstName: 'Otro',
        lastName: 'Cliente',
        email: user.email,
      })

    expect(res.status).toBe(409)
  })
})

describe('paridad entre /api/users y /api/admin/users', () => {
  it(
    'la superficie legada exige los mismos permisos que la de administración',
    async () => {
      const legacy = await request(app).get('/api/users').set('Cookie', authCookie(user))
      const adminRoute = await request(app).get('/api/admin/users').set('Cookie', authCookie(user))

      // /api/admin/users se protege con router.use(authenticate, authorize('admin')).
      // /api/users sirve el mismo recurso sin exigir admin. Mientras dure el
      // bug P0, la comparación de abajo falla y por eso la prueba es it.fails.
      expect(adminRoute.status).toBe(403)
      expect(legacy.status).toBe(adminRoute.status)
    }
  )

  it('un administrador obtiene el mismo recurso por las dos superficies', async () => {
    const legacy = await request(app).get('/api/users').set('Cookie', authCookie(admin))
    const adminRoute = await request(app).get('/api/admin/users').set('Cookie', authCookie(admin))

    expect(legacy.status).toBe(200)
    expect(adminRoute.status).toBe(200)
    expect(legacy.body.pagination.total).toBe(adminRoute.body.pagination.total)
  })
})
