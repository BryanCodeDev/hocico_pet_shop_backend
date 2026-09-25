import crypto from 'node:crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { query, queryOne } from '../../src/config/database.js'
import { resetDatabase } from '../helpers/db.js'
import {
  createUser,
  createProduct,
  createCategory,
  createOrder,
  getProductStock,
  countStockMovements,
} from '../helpers/factories.js'

// La facturación electrónica (Factus) se dispara sin `await` desde el webhook.
// Se sustituye solo esa función con un mock (parcial, porque routes/invoices.js
// usa el resto de los exports del módulo). Si corresse de verdad, chocaría con
// el TRUNCATE de la siguiente suite y produciría un fallo de FK en `invoices`
// que no corresponde a este archivo.
vi.mock('../../src/controllers/invoiceController.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    triggerInvoiceGeneration: vi.fn(async () => null),
  }
})

/**
 * Webhook de pago (Wompi). Es el único canal asíncrono del sistema y el
 * que decide si un pedido queda pagado y si el stock se devuelve.
 *
 * ---------------------------------------------------------------------
 * REGRESIÓN P0 (corregido): el INSERT INTO payments declaraba 13
 * placeholders con solo 12 parámetros. mysql2 lanzaba
 * "Incorrect arguments to COM_STMT_EXECUTE", la transacción revertía y
 * TODOS los pagos terminaban en 500: Wompi reintentaba indefinidamente y
 * el pedido se quedaba en `payment_status = pending` para siempre. El
 * cliente pagaba y el pedido nunca se preparaba ni se facturaba.
 *
 * Estas pruebas son el guardián de ese arreglo: si vuelve a desajustarse
 * un placeholder, la suite entera se pone roja.
 * ---------------------------------------------------------------------
 */

let customer
let product
let order

const ORDER_TOTAL = 50000
const INITIAL_STOCK = 10
const SOLD_QTY = 2

const PROPERTIES = [
  'transaction.id',
  'transaction.reference',
  'transaction.status',
  'transaction.amount_in_cents',
]

function sign(data, properties, timestamp) {
  const resolve = (path) => {
    const parts = path.split('.')
    let cur = data
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part]
      else return ''
    }
    return cur == null ? '' : String(cur)
  }
  const payload = properties.map(resolve).join('') + String(timestamp) + (process.env.WOMPI_EVENTS_SECRET || '')
  return crypto.createHash('sha256').update(payload).digest('hex').toUpperCase()
}

function buildEvent({ status = 'APPROVED', reference, amountInCents, timestamp = 1700000000 }) {
  const data = {
    transaction: {
      id: `tx_${status.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`,
      status,
      reference,
      amount_in_cents: amountInCents,
      currency: 'COP',
      customer_email: customer.email,
    },
  }

  return {
    event: 'transaction.status.updated',
    data,
    signature: { properties: PROPERTIES, timestamp, checksum: sign(data, PROPERTIES, timestamp) },
    sent_at: '2026-01-01T00:00:00.000Z',
  }
}

function postEvent(event, { withChecksum = true } = {}) {
  const req = request(app).post('/api/payments/webhook')
  if (withChecksum) req.set('X-Event-Checksum', event.signature.checksum)
  return req.send(event)
}

beforeEach(async () => {
  await resetDatabase()
  customer = await createUser({ role: 'user' })
  const category = await createCategory()
  product = await createProduct({
    categoryId: category.id,
    price: ORDER_TOTAL / SOLD_QTY,
    stock: INITIAL_STOCK,
    sku: 'SKU-WH-1',
  })
  order = await createOrder({
    userId: customer.id,
    orderNumber: 'ORD-WEBHOOK-1',
    total: ORDER_TOTAL,
    items: [
      {
        productId: product.id,
        name: 'Producto Webhook',
        sku: 'SKU-WH-1',
        slug: 'producto-webhook',
        quantity: SOLD_QTY,
        unitPrice: ORDER_TOTAL / SOLD_QTY,
      },
    ],
  })

  // Estado tras crear el pedido: el stock ya salió del almacén.
  await query('UPDATE products SET stock = stock - ? WHERE id = ?', [SOLD_QTY, product.id])
})

describe('POST /api/payments/webhook — verificación de firma', () => {
  it('rechaza con 401 un evento sin cabecera de checksum', async () => {
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    event.signature.checksum = ''

    expect((await postEvent(event)).status).toBe(401)
  })

  it('rechaza con 401 un checksum incorrecto', async () => {
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    event.signature.checksum = 'F'.repeat(64)

    expect((await postEvent(event)).status).toBe(401)
  })

  it('rechaza con 401 un checksum calculado con otro secreto', async () => {
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    // Firma con el formato correcto pero hecha con un secreto ajeno: es
    // exactamente lo que haría un atacante que fonda una firma de pago.
    event.signature.checksum = crypto
      .createHash('sha256')
      .update('datos1700000000secreto-del-atacante')
      .digest('hex')
      .toUpperCase()

    expect((await postEvent(event)).status).toBe(401)
  })

  it('no aplica ningún efecto cuando la firma es inválida', async () => {
    const before = await getProductStock(product.id)
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    event.signature.checksum = 'F'.repeat(64)

    await postEvent(event)

    expect(await getProductStock(product.id)).toBe(before)
    const fresh = await queryOne('SELECT payment_status FROM orders WHERE id = ?', [order.id])
    expect(fresh.payment_status).toBe('pending')
  })
})

describe('POST /api/payments/webhook — pago aprobado', () => {
  it('marca el pedido como pagado', async () => {
    const res = await postEvent(
      buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    )

    expect(res.status).toBe(200)
    const updated = await queryOne('SELECT status, payment_status FROM orders WHERE id = ?', [order.id])
    expect(updated.payment_status).toBe('approved')
    expect(updated.status).toBe('paid')
  })

  it('registra la transacción en la tabla payments', async () => {
    await postEvent(buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 }))

    const payment = await queryOne('SELECT * FROM payments WHERE order_id = ?', [order.id])
    expect(payment).toBeTruthy()
    expect(payment.status).toBe('approved')
    expect(payment.signature_checked).toBe(1)
  })

  it('añade una entrada al historial de estados', async () => {
    await postEvent(buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 }))

    const entry = await queryOne(
      'SELECT status FROM order_status_history WHERE order_id = ? AND status = ?',
      [order.id, 'paid']
    )
    expect(entry).toBeTruthy()
  })

  it('no vuelve a descontar el stock al aprobar el pago', async () => {
    // Pasa hoy, pero de forma vacua: la transacción revierte antes de tocar
    // nada. Sirve de control para detectar el día que alguien "arregle" el
    // webhook introduciendo un segundo descuento de stock.
    const before = await getProductStock(product.id)

    await postEvent(buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 }))

    expect(await getProductStock(product.id)).toBe(before)
  })
})

describe('POST /api/payments/webhook — idempotencia', () => {
  it('un evento repetido no altera el stock', async () => {
    const before = await getProductStock(product.id)
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })

    await postEvent(event)
    await postEvent(event)
    await postEvent(event)

    expect(await getProductStock(product.id)).toBe(before)
  })

  it('mantiene el pedido pagado tras los reintentos de la pasarela', async () => {
    const event = buildEvent({ reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })

    await postEvent(event)
    await postEvent(event)

    const updated = await queryOne('SELECT payment_status, status FROM orders WHERE id = ?', [order.id])
    expect(updated.payment_status).toBe('approved')
    expect(updated.status).toBe('paid')
  })
})

describe('POST /api/payments/webhook — pago rechazado', () => {
  it('restaura el stock del pedido', async () => {
    const before = await getProductStock(product.id)

    await postEvent(
      buildEvent({ status: 'DECLINED', reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    )

    expect(await getProductStock(product.id)).toBe(before + SOLD_QTY)
  })

  it('restaura el stock una sola vez aunque el evento se repita', async () => {
    const before = await getProductStock(product.id)
    const event = buildEvent({
      status: 'DECLINED',
      reference: order.order_number,
      amountInCents: ORDER_TOTAL * 100,
    })

    await postEvent(event)
    await postEvent(event)
    await postEvent(event)

    // Si la restauración no fuera idempotente, el stock inflaría tres veces.
    expect(await getProductStock(product.id)).toBe(before + SOLD_QTY)
  })

  it('marca el pago como rechazado', async () => {
    await postEvent(
      buildEvent({ status: 'DECLINED', reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    )

    const updated = await queryOne('SELECT payment_status FROM orders WHERE id = ?', [order.id])
    expect(updated.payment_status).toBe('rejected')
  })

  it('registra el movimiento de reinstate en stock_movements', async () => {
    await postEvent(
      buildEvent({ status: 'DECLINED', reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    )

    expect(await countStockMovements(product.id, 'in')).toBe(1)
  })
})

describe('POST /api/payments/webhook — pago anulado (VOIDED)', () => {
  it('cancela el pedido y devuelve el stock', async () => {
    const before = await getProductStock(product.id)

    await postEvent(
      buildEvent({ status: 'VOIDED', reference: order.order_number, amountInCents: ORDER_TOTAL * 100 })
    )

    const updated = await queryOne('SELECT status, payment_status FROM orders WHERE id = ?', [order.id])
    expect(updated.status).toBe('cancelled')
    expect(updated.payment_status).toBe('cancelled')
    expect(await getProductStock(product.id)).toBe(before + SOLD_QTY)
  })
})

describe('POST /api/payments/webhook — referencias desconocidas', () => {
  it('responde 200 cuando la referencia no corresponde a ningún pedido', async () => {
    const res = await postEvent(buildEvent({ reference: 'ORD-QUE-NO-EXISTE', amountInCents: 1000 }))

    // La pasarela reintenta si no recibe 200; lo desconocido debe ser un 200.
    expect(res.status).toBe(200)
  })

  it('responde 200 cuando el evento no trae estado de transacción', async () => {
    const data = {}
    const event = {
      event: 'ping',
      data,
      signature: { properties: [], timestamp: 1700000000, checksum: sign(data, [], 1700000000) },
    }

    expect((await postEvent(event)).status).toBe(200)
  })
})

describe('POST /api/payments/webhook — congruencia del importe', () => {
  it('debería rechazar un evento cuyo importe no coincide con el total del pedido', async () => {
    const before = await getProductStock(product.id)

    // El importe notificado nunca se comparaba con orders.total. La firma
    // protege contra falsificar el evento, NO contra que la pasarela notifique
    // una cifra distinta: un pedido de $500.000 quedaba "pagado" y se facturaba
    // tras un pago de $1. La comprobación está en paymentController.webhook.
    const res = await postEvent(
      buildEvent({ reference: order.order_number, amountInCents: 100 })
    )

    expect(res.status).toBe(400)
    const updated = await queryOne('SELECT payment_status FROM orders WHERE id = ?', [order.id])
    expect(updated.payment_status).not.toBe('approved')
    expect(await getProductStock(product.id)).toBe(before)
  })
})
