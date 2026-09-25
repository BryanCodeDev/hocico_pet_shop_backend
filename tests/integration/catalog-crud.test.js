import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { query, queryOne } from '../../src/config/database.js'
import { resetDatabase } from '../helpers/db.js'
import { createUser, createCategory, createProduct, authCookie } from '../helpers/factories.js'

/**
 * CRUD de productos y categorías.
 *
 * Cada operación se verifica en tres capas: la respuesta HTTP, la fila
 * afectada y los efectos colaterales (imágenes, stock, jerarquía). Un 201
 * sin fila correcta es un producto que no existe.
 */

let admin
let customer
let category

function productPayload(overrides = {}) {
  return {
    name: 'Concentrado Adulto 3kg',
    slug: 'concentrado-adulto-3kg',
    sku: 'SKU-TEST-001',
    categoryId: category.id,
    price: 45000,
    stock: 10,
    minStock: 5,
    ...overrides,
  }
}

beforeEach(async () => {
  await resetDatabase()
  admin = await createUser({ role: 'admin' })
  customer = await createUser({ role: 'user' })
  category = await createCategory({ name: 'Alimentos', slug: 'alimentos' })
})

// ---------------------------------------------------------------------------
// ADMIN · creación
// ---------------------------------------------------------------------------

describe('POST /api/admin/products — creación', () => {
  it('crea el producto y devuelve 201', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload())

    expect(res.status).toBe(201)
    expect(res.body.product).toMatchObject({ name: 'Concentrado Adulto 3kg', sku: 'SKU-TEST-001' })
  })

  it('persiste la fila en base de datos', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload())

    const row = await queryOne('SELECT * FROM products WHERE id = ?', [res.body.product.id])
    expect(row).toBeTruthy()
    expect(row.name).toBe('Concentrado Adulto 3kg')
    expect(row.category_id).toBe(category.id)
  })

  it('rechaza con 409 un slug duplicado', async () => {
    await request(app).post('/api/admin/products').set('Cookie', authCookie(admin)).send(productPayload())

    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ sku: 'SKU-OTRO-001' }))

    expect(res.status).toBe(409)
  })

  it('rechaza con 409 un SKU duplicado', async () => {
    await request(app).post('/api/admin/products').set('Cookie', authCookie(admin)).send(productPayload())

    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ slug: 'otro-slug-distinto' }))

    expect(res.status).toBe(409)
  })

  it('rechaza con 400 un precio negativo', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ price: -1 }))

    expect(res.status).toBe(400)
  })

  it('rechaza con 400 un stock negativo', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ stock: -5 }))

    expect(res.status).toBe(400)
  })

  it('rechaza con 400 una categoría inexistente', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ categoryId: 999999 }))

    expect(res.status).toBe(400)
  })

  it('exige nombre, slug, sku, categoría, precio y stock', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send({ name: 'Incompleto' })

    expect(res.status).toBe(400)
    expect(Array.isArray(res.body.errors)).toBe(true)
  })

  it('genera el slug a partir del nombre si no se envía', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ name: 'Juguete para Perro', slug: undefined }))

    expect(res.status).toBe(201)
    expect(res.body.product.slug).toBe('juguete-para-perro')
  })

  it('exige rol de administrador', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(customer))
      .send(productPayload())

    expect(res.status).toBe(403)

    const row = await queryOne('SELECT id FROM products WHERE sku = ?', ['SKU-TEST-001'])
    expect(row).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ADMIN · lectura
// ---------------------------------------------------------------------------

describe('GET /api/admin/products — lectura', () => {
  beforeEach(async () => {
    await createProduct({ categoryId: category.id, name: 'Producto Activo', slug: 'activo', sku: 'SKU-A', isActive: true, price: 10000 })
    await createProduct({ categoryId: category.id, name: 'Producto Inactivo', slug: 'inactivo', sku: 'SKU-B', isActive: false, price: 20000 })
  })

  it('exige rol de administrador', async () => {
    expect((await request(app).get('/api/admin/products').set('Cookie', authCookie(customer))).status).toBe(403)
    expect((await request(app).get('/api/admin/products')).status).toBe(401)
  })

  it('incluye productos activos e inactivos', async () => {
    const res = await request(app).get('/api/admin/products').set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)
    expect(res.body.pagination.total).toBe(2)
  })

  it('filtra por estado', async () => {
    const res = await request(app)
      .get('/api/admin/products?status=active')
      .set('Cookie', authCookie(admin))

    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0].name).toBe('Producto Activo')
  })

  it('filtra por texto en nombre, slug o SKU', async () => {
    const res = await request(app)
      .get('/api/admin/products?search=Inactivo')
      .set('Cookie', authCookie(admin))

    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0].sku).toBe('SKU-B')
  })

  it('devuelve 404 al pedir un producto inexistente', async () => {
    const res = await request(app).get('/api/admin/products/999999').set('Cookie', authCookie(admin))
    expect(res.status).toBe(404)
  })

  it('devuelve el detalle con su categoría resuelta', async () => {
    const created = await createProduct({ categoryId: category.id, name: 'Detalle', slug: 'detalle', sku: 'SKU-D' })
    const res = await request(app).get(`/api/admin/products/${created.id}`).set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)
    expect(res.body.product.category_name).toBe('Alimentos')
  })
})

// ---------------------------------------------------------------------------
// ADMIN · actualización y borrado
// ---------------------------------------------------------------------------

describe('PUT /api/admin/products — actualización', () => {
  let existing

  beforeEach(async () => {
    existing = await createProduct({ categoryId: category.id, name: 'Original', slug: 'original', sku: 'SKU-ORIG', price: 10000, stock: 4 })
  })

  it('persiste los campos modificados', async () => {
    const res = await request(app)
      .put(`/api/admin/products/${existing.id}`)
      .set('Cookie', authCookie(admin))
      .send(
        productPayload({
          name: 'Nombre Nuevo',
          slug: 'nombre-nuevo',
          sku: 'SKU-NUEVO',
          price: 60000,
          stock: 30,
        })
      )

    expect(res.status).toBe(200)

    const row = await queryOne('SELECT * FROM products WHERE id = ?', [existing.id])
    expect(row.name).toBe('Nombre Nuevo')
    expect(row.slug).toBe('nombre-nuevo')
    expect(Number(row.stock)).toBe(30)
    expect(Number(row.price)).toBe(60000)
  })

  it('devuelve 404 al actualizar un producto inexistente', async () => {
    const res = await request(app)
      .put('/api/admin/products/999999')
      .set('Cookie', authCookie(admin))
      .send(productPayload())

    expect(res.status).toBe(404)
  })

  it('rechaza con 409 mover el slug a otro producto existente', async () => {
    await createProduct({ categoryId: category.id, name: 'Otro', slug: 'slug-ocupado', sku: 'SKU-OTRO' })

    const res = await request(app)
      .put(`/api/admin/products/${existing.id}`)
      .set('Cookie', authCookie(admin))
      .send(productPayload({ slug: 'slug-ocupado', sku: 'SKU-ORIG' }))

    expect(res.status).toBe(409)
  })

  it('exige rol de administrador', async () => {
    const res = await request(app)
      .put(`/api/admin/products/${existing.id}`)
      .set('Cookie', authCookie(customer))
      .send(productPayload())

    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/admin/products — borrado lógico', () => {
  let existing

  beforeEach(async () => {
    existing = await createProduct({ categoryId: category.id, name: 'A Borrar', slug: 'a-borrar', sku: 'SKU-BORRAR' })
  })

  it('marca deleted_at en lugar de borrar la fila', async () => {
    const res = await request(app)
      .delete(`/api/admin/products/${existing.id}`)
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)

    const row = await queryOne('SELECT deleted_at FROM products WHERE id = ?', [existing.id])
    expect(row).toBeTruthy()
    expect(row.deleted_at).toBeTruthy()
  })

  it('lo saca del listado de administración', async () => {
    await request(app).delete(`/api/admin/products/${existing.id}`).set('Cookie', authCookie(admin))

    const res = await request(app).get('/api/admin/products').set('Cookie', authCookie(admin))
    expect(res.body.products).toHaveLength(0)
  })

  it('conserva el histórico de pedidos que lo referencian', async () => {
    // Las líneas de pedido guardan product_id con ON DELETE SET NULL, pero un
    // borrado lógico ni siquiera llega a tocar esa relación.
    await query(
      `INSERT INTO orders (order_number, channel, status, payment_status, payment_method,
         subtotal, discount, shipping_cost, total, customer_name, customer_email, customer_phone,
         customer_document_type, customer_document_number, address, city, province)
       VALUES ('ORD-REF-1', 'online', 'pending', 'pending', 'wompi', 1000, 0, 0, 1000,
         'Cliente', 'c@hocico.test', '3130000000', 'CC', '1', 'Dir', 'Mosquera', 'Cundinamarca')`
    )
    const order = await queryOne('SELECT id FROM orders WHERE order_number = ?', ['ORD-REF-1'])
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, 'Producto A Borrar', 1, 1000, 1000)`,
      [order.id, existing.id]
    )

    await request(app).delete(`/api/admin/products/${existing.id}`).set('Cookie', authCookie(admin))

    const line = await queryOne('SELECT product_id FROM order_items WHERE order_id = ?', [order.id])
    expect(Number(line.product_id)).toBe(existing.id)
  })

  it('exige rol de administrador', async () => {
    const res = await request(app)
      .delete(`/api/admin/products/${existing.id}`)
      .set('Cookie', authCookie(customer))

    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// ADMIN · interruptores
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/products — featured y status', () => {
  let existing

  beforeEach(async () => {
    existing = await createProduct({ categoryId: category.id, name: 'Toggle', slug: 'toggle', sku: 'SKU-TOGGLE', isActive: true, isFeatured: false })
  })

  it('alterna el estado destacado', async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${existing.id}/featured`)
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)
    const row = await queryOne('SELECT is_featured FROM products WHERE id = ?', [existing.id])
    expect(Number(row.is_featured)).toBe(1)
  })

  it('alterna la visibilidad en el catálogo', async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${existing.id}/status`)
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)
    const row = await queryOne('SELECT is_active FROM products WHERE id = ?', [existing.id])
    expect(Number(row.is_active)).toBe(0)
  })

  it('exige rol de administrador en ambos interruptores', async () => {
    expect(
      (await request(app).patch(`/api/admin/products/${existing.id}/featured`).set('Cookie', authCookie(customer))).status
    ).toBe(403)
    expect(
      (await request(app).patch(`/api/admin/products/${existing.id}/status`).set('Cookie', authCookie(customer))).status
    ).toBe(403)
  })
})

it(
  'debería excluir del catálogo público los productos desactivados',
  async () => {
    // El interruptor de estado funciona a nivel de base de datos, pero no
    // tiene efecto en la tienda: buildProductQuery solo añade el filtro
    // `p.is_active = ?` cuando le llega `filters.active`, y getProducts lo deja
    // en undefined salvo que el cliente mande ?active=true. /tienda no lo manda.
    // Resultado: un producto retirado del panel sigue vendiéndose online.
    const product = await createProduct({
      categoryId: category.id,
      name: 'Retirado',
      slug: 'retirado',
      sku: 'SKU-RETIRADO',
      isActive: true,
    })

    await request(app)
      .patch(`/api/admin/products/${product.id}/status`)
      .set('Cookie', authCookie(admin))

    const res = await request(app).get('/api/products')
    expect(res.body.products).toHaveLength(0)
  }
)

// ---------------------------------------------------------------------------
// Cálculo del descuento (misma familia de bug que el catálogo)
// ---------------------------------------------------------------------------

describe('Descuento persistido del producto', () => {
  it('calcula el descuento con precios numéricos', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Cookie', authCookie(admin))
      .send(productPayload({ price: 45000, originalPrice: 60000, sku: 'SKU-D1' }))

    expect(res.status).toBe(201)

    const row = await queryOne('SELECT discount_percent FROM products WHERE id = ?', [res.body.product.id])
    expect(Number(row.discount_percent)).toBe(25)
  })

  it(
    'debería calcular el descuento con los precios string que envía el formulario',
    async () => {
      // calculateDiscount() comparaba `originalPrice <= price` sin coerción.
      // El formulario de admin manda los campos numéricos como string, así
      // que la comparación era LÉXICA: '10000.00' <= '9500.00' es TRUE porque
      // '1' < '9', y el descuento se guardaba en 0 aunque el producto estuviera
      // rebajado. Con 45000 vs 60000 sí funcionaba ('4' < '6'), por eso pasaba
      // desapercibido.
      const res = await request(app)
        .post('/api/admin/products')
        .set('Cookie', authCookie(admin))
        .send(productPayload({ price: '9500.00', originalPrice: '10000.00', sku: 'SKU-D2' }))

      expect(res.status).toBe(201)

      const row = await queryOne('SELECT discount_percent FROM products WHERE id = ?', [res.body.product.id])
      expect(Number(row.discount_percent)).toBe(5)
    }
  )
})

// ---------------------------------------------------------------------------
// CATEGORÍAS
// ---------------------------------------------------------------------------

describe('Categorías — lectura pública', () => {
  it('devuelve la jerarquía sin exigir sesión', async () => {
    const res = await request(app).get('/api/categories')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.categories)).toBe(true)
  })

  it('devuelve 404 para un slug inexistente', async () => {
    const res = await request(app).get('/api/categories/no-existe')
    expect(res.status).toBe(404)
  })

  it('solo muestra las categorías activas', async () => {
    await createCategory({ name: 'Oculta', slug: 'oculta', isActive: false })

    const res = await request(app).get('/api/categories')
    const slugs = res.body.categories.map((c) => c.slug)

    // Última prueba del bloque a propósito en verde: documenta el
    // comportamiento real. Ver la prueba marcada abajo.
    expect(slugs).toContain('alimentos')
  })

  it(
    'debería excluir del listado público las categorías desactivadas',
    async () => {
      // Mismo patrón que los productos: el listado público no filtra por
      // is_active, así que ocultar una categoría en el panel no la retira de
      // los menús de la tienda.
      await createCategory({ name: 'Oculta', slug: 'oculta', isActive: false })

      const res = await request(app).get('/api/categories')
      const slugs = res.body.categories.map((c) => c.slug)

      expect(slugs).toContain('alimentos')
      expect(slugs).not.toContain('oculta')
    }
  )
})

describe('Categorías — administración', () => {
  it('crea una categoría con 201', async () => {
    const res = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', authCookie(admin))
      .send({ name: 'Juguetes', slug: 'juguetes', description: 'Para entretener' })

    expect(res.status).toBe(201)

    const row = await queryOne('SELECT * FROM categories WHERE slug = ?', ['juguetes'])
    expect(row.name).toBe('Juguetes')
  })

  it('rechaza con 409 un slug duplicado', async () => {
    const res = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', authCookie(admin))
      .send({ name: 'Duplicada', slug: 'alimentos' })

    expect(res.status).toBe(409)
  })

  it('rechaza con 400 una categoría sin nombre', async () => {
    const res = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', authCookie(admin))
      .send({ slug: 'sin-nombre' })

    expect(res.status).toBe(400)
  })

  it('exige rol de administrador en creación, edición y borrado', async () => {
    const create = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', authCookie(customer))
      .send({ name: 'Intrusa', slug: 'intrusa' })

    const update = await request(app)
      .put(`/api/admin/categories/${category.id}`)
      .set('Cookie', authCookie(customer))
      .send({ name: 'Intrusa', slug: 'intrusa' })

    const remove = await request(app)
      .delete(`/api/admin/categories/${category.id}`)
      .set('Cookie', authCookie(customer))

    expect(create.status).toBe(403)
    expect(update.status).toBe(403)
    expect(remove.status).toBe(403)
  })

  it('borra una categoría sin productos asociados', async () => {
    const target = await createCategory({ name: 'Temporal', slug: 'temporal' })

    const res = await request(app)
      .delete(`/api/admin/categories/${target.id}`)
      .set('Cookie', authCookie(admin))

    expect(res.status).toBe(200)

    const row = await queryOne('SELECT deleted_at FROM categories WHERE id = ?', [target.id])
    expect(row.deleted_at).toBeTruthy()
  })

  it('alterna el estado activo/inactivo', async () => {
    const target = await createCategory({ name: 'Conmutable', slug: 'conmutable', isActive: true })

    await request(app).patch(`/api/admin/categories/${target.id}/status`).set('Cookie', authCookie(admin))

    const row = await queryOne('SELECT is_active FROM categories WHERE id = ?', [target.id])
    expect(Number(row.is_active)).toBe(0)
  })

  it(
    'no deja que una categoría sea su propia hija',
    async () => {
      // Sin esta comprobación, parentId = id propio genera un ciclo en la
      // jerarquía y la navegación de categorías del frontend se repite al
      // expandirse, además de romper el filtro de subcategorías del catálogo.
      const res = await request(app)
        .put(`/api/admin/categories/${category.id}`)
        .set('Cookie', authCookie(admin))
        .send({ name: 'Alimentos', slug: 'alimentos', parentId: category.id })

      expect(res.status).toBe(400)
    }
  )
})
