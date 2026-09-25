import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { query, queryOne } from '../../src/config/database.js'
import { resetDatabase } from '../helpers/db.js'
import {
  createUser,
  createProduct,
  createCategory,
  authCookie,
  getProductStock,
  countOrderItems,
  countStockMovements,
} from '../helpers/factories.js'

/**
 * Camino de dinero: creación del pedido.
 *
 * Cada mutación se verifica en tres capas — respuesta HTTP, filas afectadas
 * y efectos colaterales (stock, movimientos, historial). Un 201 sin filas
 * correctas es un pedido que el cliente paga y el negocio no puede preparar.
 */

let customer
let otherCustomer
let category
let product
let scarceProduct

const validOrder = (overrides = {}) => ({
  customerName: 'Ana Cliente',
  customerEmail: 'ana@hocico.test',
  customerPhone: '3130000000',
  address: 'Calle 1 # 2-3',
  city: 'Mosquera',
  province: 'Cundinamarca',
  items: [{ productId: null, quantity: 1 }],
  paymentMethod: 'wompi',
  ...overrides,
})

beforeEach(async () => {
  await resetDatabase()
  customer = await createUser({ role: 'user' })
  otherCustomer = await createUser({ role: 'user' })
  category = await createCategory()
  product = await createProduct({ categoryId: category.id, price: 50000, stock: 10, sku: 'SKU-OK-1' })
  scarceProduct = await createProduct({ categoryId: category.id, price: 10000, stock: 2, sku: 'SKU-ESC-1' })
})

describe('POST /api/orders — creación correcta', () => {
  it(
    'debería crear el pedido con sus líneas de detalle',
    async () => {
      const payload = validOrder({
        items: [{ productId: product.id, quantity: 2 }],
      })

      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(payload)

      expect(res.status).toBe(201)

      // REGRESIÓN P0 (corregido) — orderController.js insertaba cada línea con
      // `order_id = 0` porque la cabecera aún no existía, y luego intentaba
      // repararlo buscando por `item.sku`, campo que el cliente nunca envía
      // (orderValidation solo valida productId y quantity). El WHERE no casaba
      // y, como order_items.order_id tiene FK a orders(id), el INSERT violaba
      // la restricción: la transacción revertía y el endpoint devolvía 500 en
      // TODOS los pedidos. La tienda no aceptaba ni una sola venta online.
      const orderId = res.body.order.id
      expect(await countOrderItems(orderId)).toBe(1)
    }
  )

  it(
    'debería descontar el stock del producto pedido',
    async () => {
      const before = await getProductStock(product.id)

      await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(validOrder({ items: [{ productId: product.id, quantity: 2 }] }))

      expect(await getProductStock(product.id)).toBe(before - 2)
    }
  )

  it(
    'debería registrar el movimiento de salida en stock_movements',
    async () => {
      await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(validOrder({ items: [{ productId: product.id, quantity: 2 }] }))

      expect(await countStockMovements(product.id, 'out')).toBe(1)
    }
  )

  it('acepta pedidos de clientes invitados, sin sesión', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(validOrder({ items: [{ productId: product.id, quantity: 1 }] }))

    // El endpoint es público a propósito: se puede comprar sin registrarse.
    expect(res.status).not.toBe(401)
  })
})

describe('POST /api/orders — validación de entrada', () => {
  it('rechaza un pedido sin items con 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ items: [] }))

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('rechaza un email inválido con 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ customerEmail: 'no-es-un-correo', items: [{ productId: product.id, quantity: 1 }] }))

    expect(res.status).toBe(400)
  })

  it('rechaza un método de pago desconocido con 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ paymentMethod: 'bitcoin', items: [{ productId: product.id, quantity: 1 }] }))

    expect(res.status).toBe(400)
  })

  it('rechaza cantidades no enteras o no positivas con 400', async () => {
    for (const quantity of [0, -1, 1.5, 'dos']) {
      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(validOrder({ items: [{ productId: product.id, quantity }] }))

      expect(res.status, `quantity=${quantity}`).toBe(400)
    }
  })

  it('rechaza un productId inexistente o no numérico con 400', async () => {
    for (const productId of ['abc', -5, 0]) {
      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(validOrder({ items: [{ productId, quantity: 1 }] }))

      expect(res.status, `productId=${productId}`).toBe(400)
    }
  })

  it('exige provincia o departamento', async () => {
    const payload = validOrder({ items: [{ productId: product.id, quantity: 1 }] })
    delete payload.province

    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(payload)

    expect(res.status).toBe(400)
  })
})

describe('POST /api/orders — stock insuficiente', () => {
  it('devuelve 409 cuando se piden más unidades de las disponibles', async () => {
    const before = await getProductStock(scarceProduct.id)

    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ items: [{ productId: scarceProduct.id, quantity: 99 }] }))

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/stock/i)
  })

  it('no descuenta stock cuando el pedido se rechaza por falta de existencias', async () => {
    await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ items: [{ productId: scarceProduct.id, quantity: 99 }] }))

    expect(await getProductStock(scarceProduct.id)).toBe(2)
  })
})

describe('POST /api/orders — atomicidad de la transacción', () => {
  it(
    'no deja el primer producto descontado si el segundo falla',
    async () => {
      const stockBefore = await getProductStock(product.id)

      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(
          validOrder({
            items: [
              { productId: product.id, quantity: 1 },
              { productId: scarceProduct.id, quantity: 99 },
            ],
          })
        )

      // El 409 de stock insuficiente depende de que el flujo llegue hasta la
      // comprobación de existencias, que solo es posible con el arreglo de
      // order_id=0 aplicado. Antes revirtía antes por la FK.
      expect(res.status).toBe(409)
      expect(await getProductStock(product.id)).toBe(stockBefore)
    }
  )

  it('no crea ninguna fila en orders cuando la transacción revierte', async () => {
    const before = await queryOne('SELECT COUNT(*) AS n FROM orders')

    await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ items: [{ productId: scarceProduct.id, quantity: 99 }] }))

    const after = await queryOne('SELECT COUNT(*) AS n FROM orders')
    expect(Number(after.n)).toBe(Number(before.n))
  })

  it('no deja líneas de pedido huérfanas tras un fallo', async () => {
    const before = await queryOne('SELECT COUNT(*) AS n FROM order_items')

    await request(app)
      .post('/api/orders')
      .set('Cookie', authCookie(customer))
      .send(validOrder({ items: [{ productId: scarceProduct.id, quantity: 99 }] }))

    const after = await queryOne('SELECT COUNT(*) AS n FROM order_items')
    expect(Number(after.n)).toBe(Number(before.n))
  })
})

describe('POST /api/orders — coste de envío', () => {
  it(
    'toma el coste de la zona de envío activa de la ciudad',
    async () => {
      // seed.sql deja Mosquera con coste 0 y Madrid con 5000.
      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(
          validOrder({
            city: 'Madrid',
            province: 'Cundinamarca',
            items: [{ productId: product.id, quantity: 1 }],
          })
        )

      expect(res.status).toBe(201)
      expect(Number(res.body.order.shipping_cost)).toBe(5000)
      expect(Number(res.body.order.total)).toBe(55000)
    }
  )

  it(
    'deja el envío en 0 para una ciudad fuera de las zonas configuradas',
    async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Cookie', authCookie(customer))
        .send(
          validOrder({
            city: 'Ciudad Inexistente',
            items: [{ productId: product.id, quantity: 1 }],
          })
        )

      expect(res.status).toBe(201)
      expect(Number(res.body.order.shipping_cost)).toBe(0)
    }
  )
})

describe('GET /api/orders/my — aislamiento entre cuentas', () => {
  it('rechaza la petición sin sesión con 401', async () => {
    const res = await request(app).get('/api/orders/my')
    expect(res.status).toBe(401)
  })

  it('devuelve únicamente los pedidos del usuario autenticado', async () => {
    await query(
      `INSERT INTO orders (order_number, channel, status, payment_status, payment_method,
         subtotal, discount, shipping_cost, total, customer_name, customer_email, customer_phone,
         customer_document_type, customer_document_number, address, city, province, user_id)
       VALUES ('ORD-MIO-1', 'online', 'pending', 'pending', 'wompi', 1000, 0, 0, 1000,
         'Yo', 'yo@hocico.test', '3130000000', 'CC', '1', 'Dir', 'Mosquera', 'Cundinamarca', ?)`,
      [customer.id]
    )
    await query(
      `INSERT INTO orders (order_number, channel, status, payment_status, payment_method,
         subtotal, discount, shipping_cost, total, customer_name, customer_email, customer_phone,
         customer_document_type, customer_document_number, address, city, province, user_id)
       VALUES ('ORD-OTRO-1', 'online', 'pending', 'pending', 'wompi', 1000, 0, 0, 1000,
         'Otro', 'otro@hocico.test', '3130000001', 'CC', '2', 'Dir', 'Mosquera', 'Cundinamarca', ?)`,
      [otherCustomer.id]
    )

    const res = await request(app).get('/api/orders/my').set('Cookie', authCookie(customer))

    expect(res.status).toBe(200)
    expect(res.body.orders).toHaveLength(1)
    expect(res.body.orders[0].order_number).toBe('ORD-MIO-1')
  })

  it('devuelve una lista vacía, no un error, si el usuario no tiene pedidos', async () => {
    const res = await request(app).get('/api/orders/my').set('Cookie', authCookie(customer))

    expect(res.status).toBe(200)
    expect(res.body.orders).toEqual([])
  })
})

describe('GET /api/orders/:id — no suplantar pedidos ajenos', () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO orders (order_number, channel, status, payment_status, payment_method,
         subtotal, discount, shipping_cost, total, customer_name, customer_email, customer_phone,
         customer_document_type, customer_document_number, address, city, province, user_id)
       VALUES ('ORD-PRIVADO', 'online', 'pending', 'pending', 'wompi', 1000, 0, 0, 1000,
         'Dueño', 'dueno@hocico.test', '3130000000', 'CC', '1', 'Dir', 'Mosquera', 'Cundinamarca', ?)`,
      [otherCustomer.id]
    )
  })

  it('devuelve 404 a un usuario que pide el pedido de otro', async () => {
    const target = await queryOne('SELECT id FROM orders WHERE order_number = ?', ['ORD-PRIVADO'])

    const res = await request(app)
      .get(`/api/orders/${target.id}`)
      .set('Cookie', authCookie(customer))

    // getOrderById filtra por user_id, así que el pedido ajeno es indistinguible
    // de uno inexistente. Correcto: no revela que el id existe.
    expect(res.status).toBe(404)
  })

  it(
    'permite al dueño ver su propio pedido',
    async () => {
      const target = await queryOne('SELECT id FROM orders WHERE order_number = ?', ['ORD-PRIVADO'])

      const res = await request(app)
        .get(`/api/orders/${target.id}`)
        .set('Cookie', authCookie(otherCustomer))

      // REGRESIÓN P0 (corregido) — orderController.js:getOrderById consultaba
      // `p.images`, pero `products` no tiene esa columna (las imágenes viven en
      // product_images). MySQL lanzaba "Unknown column" y respondía 500. El
      // caso del pedido ajeno pasaba solo porque el filtro por user_id
      // devuelve null ANTES de llegar a esa consulta, así que la ruta nunca se
      // ejercitaba de verdad. Consecuencia: el cliente que acaba de pagar no
      // podía ver su pedido.
      expect(res.status).toBe(200)
      expect(res.body.order.order_number).toBe('ORD-PRIVADO')
    }
  )
})
