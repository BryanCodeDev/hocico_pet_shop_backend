import crypto from 'crypto'
import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'
import { triggerInvoiceGeneration } from './invoiceController.js'

const WOMPI_ENV = process.env.WOMPI_ENV || 'sandbox'
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET
const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET

export async function getWompiConfig(order) {
  const currency = order.currency || 'COP'

  let publicKey = WOMPI_PUBLIC_KEY
  let wompiEnv = WOMPI_ENV

  if (!publicKey || !wompiEnv) {
    const rows = await query(
      'SELECT `key`, value FROM settings WHERE `key` IN ("wompi_public_key", "wompi_env")'
    )
    const settings = {}
    for (const row of rows) {
      try {
        settings[row.key] = row.value ? JSON.parse(row.value) : null
      } catch {
        settings[row.key] = null
      }
    }
    publicKey = publicKey || settings.wompi_public_key
    wompiEnv = wompiEnv || settings.wompi_env || 'sandbox'
  }

  return { publicKey, wompiEnv, currency }
}

function generateIntegritySignature(reference, amountInCents, currency) {
  const data = `${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

function mapWompiStatus(status) {
  switch (status) {
    case 'APPROVED':
      return 'approved'
    case 'DECLINED':
    case 'ERROR':
      return 'rejected'
    case 'VOIDED':
      return 'cancelled'
    case 'PENDING':
    default:
      return 'pending'
  }
}

function resolveProperty(obj, path) {
  const parts = path.split('.')
  let cur = obj
  let ok = true
  for (const part of parts) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part]
    } else {
      ok = false
      break
    }
  }
  if (ok) {
    return cur == null ? '' : String(cur)
  }
  if (parts.length > 1) {
    let cur2 = obj
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]
      if (cur2 && typeof cur2 === 'object' && Object.prototype.hasOwnProperty.call(cur2, part)) {
        cur2 = cur2[part]
      } else {
        return ''
      }
    }
    return cur2 == null ? '' : String(cur2)
  }
  return ''
}

function verifyWompiSignature(body, checksumHeader) {
  const signature = (body && body.signature) || {}
  const properties = Array.isArray(signature.properties) ? signature.properties : []
  const data = (body && body.data) || {}
  const timestamp = signature.timestamp != null ? String(signature.timestamp) : ''
  const secret = WOMPI_EVENTS_SECRET || ''

  const expected = crypto
    .createHash('sha256')
    .update(properties.map((p) => resolveProperty(data, p)).join('') + timestamp + secret)
    .digest('hex')
    .toUpperCase()

  const provided = (checksumHeader || signature.checksum || '').toUpperCase()
  if (!provided) {
    return false
  }

  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length) {
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

export async function createPayment(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { orderId } = req.body
    const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId])

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }
    if (order.payment_status === 'approved') {
      return res.status(400).json({ error: 'El pedido ya fue pagado' })
    }

    const { publicKey, wompiEnv, currency } = await getWompiConfig(order)

    if (!publicKey) {
      return res.status(500).json({ error: 'La llave pública de Wompi no está configurada' })
    }
    if (!WOMPI_INTEGRITY_SECRET) {
      return res
        .status(500)
        .json({ error: 'El secreto de integridad de Wompi no está configurado' })
    }

    const amountInCents = Math.round(Number(order.total || 0)) * 100
    const reference = order.order_number
    const integritySignature = generateIntegritySignature(reference, amountInCents, currency)

    const redirectUrl = `${process.env.FRONTEND_URL || ''}/checkout/success?orderId=${order.id}`

    await query(
      `INSERT INTO payments
        (order_id, payment_id, reference, payment_method_id, payment_type, status, amount, currency, external_reference, signature_checked)
       VALUES (?, ?, ?, 'wompi', 'wompi', 'pending', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = 'pending', updated_at = CURRENT_TIMESTAMP`,
      [order.id, reference, reference, order.total, currency, order.order_number]
    )

    res.json({
      orderId: order.id,
      publicKey,
      currency,
      amountInCents,
      reference,
      integritySignature,
      signature: integritySignature,
      environment: wompiEnv,
      redirectUrl,
      paymentMethod: 'wompi',
    })
  } catch (error) {
    console.error('Create payment error:', error)
    res.status(500).json({ error: 'Error al crear el pago' })
  }
}

export async function webhook(req, res) {
  try {
    const checksumHeader = req.get('X-Event-Checksum')

    if (!verifyWompiSignature(req.body, checksumHeader)) {
      return res.status(401).json({ error: 'Firma de evento inválida' })
    }

    const body = req.body || {}
    const data = body.data || {}
    const wompiTx = data.transaction || data

    if (!wompiTx || !wompiTx.status) {
      return res.status(200).json({ received: true })
    }

    const reference = wompiTx.reference || wompiTx.id
    const wompiTransactionId = wompiTx.id
    const wompiStatus = String(wompiTx.status || '').toUpperCase()
    const amountInCents = Number(wompiTx.amount_in_cents || 0)
    const amount = amountInCents / 100
    const payerEmail = wompiTx.customer_email || data.customer_email || null
    const payerId = wompiTx.customer_id || data.customer_id || null

    const order = await queryOne(
      'SELECT * FROM orders WHERE order_number = ? OR external_reference = ? LIMIT 1',
      [reference, reference]
    )

    if (!order) {
      return res.status(200).json({ received: true })
    }

    // La firma garantiza que el evento viene de la pasarela, NO que el importe
    // notificado sea el del pedido. Sin esta comprobación, un pedido de
    // $500.000 quedaría "pagado" y se facturaría tras un pago de $1.
    const expectedAmountInCents = Math.round(Number(order.total || 0) * 100)
    if (amountInCents > 0 && amountInCents !== expectedAmountInCents) {
      console.error(
        `Webhook con importe discrepante para ${order.order_number}: recibido ${amountInCents}, esperado ${expectedAmountInCents}`
      )
      return res.status(400).json({ error: 'El importe del pago no coincide con el total del pedido' })
    }

    const prevPaymentStatus = order.payment_status
    const newPaymentStatus = mapWompiStatus(wompiStatus)
    const isApproval = wompiStatus === 'APPROVED'
    const isFailure = ['DECLINED', 'VOIDED', 'ERROR'].includes(wompiStatus)

    const shouldInvoice = isApproval && prevPaymentStatus !== 'approved'
    const shouldRestore =
      isFailure && !['rejected', 'cancelled', 'refunded'].includes(prevPaymentStatus)

    await transaction(async (conn) => {
      await conn.execute(
        `INSERT INTO payments
          (order_id, payment_id, reference, payment_method_id, payment_type, status, status_detail,
           amount, currency, fee, net_amount, payer_email, payer_id, external_reference,
           raw_data, signature_checked, processed_at)
         VALUES (?, ?, ?, 'wompi', 'wompi', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           payment_id = VALUES(payment_id),
           status = VALUES(status),
           status_detail = VALUES(status_detail),
           amount = VALUES(amount),
           fee = VALUES(fee),
           net_amount = VALUES(net_amount),
           raw_data = VALUES(raw_data),
           signature_checked = VALUES(signature_checked),
           processed_at = VALUES(processed_at),
           updated_at = CURRENT_TIMESTAMP`,
        [
          order.id,
          wompiTransactionId,
          reference,
          newPaymentStatus,
          wompiStatus,
          amount,
          order.currency,
          amount,
          payerEmail,
          payerId,
          order.order_number,
          JSON.stringify(body),
          true,
        ]
      )

      if (isApproval) {
        await conn.execute(
          `UPDATE orders
           SET payment_status = 'approved',
               status = 'paid',
               payment_id = ?,
               paid_at = NOW(),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [wompiTransactionId, order.id]
        )
        await conn.execute(
          `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
           VALUES (?, 'paid', ?, NULL, ?)`,
          [order.id, order.status, `Pago aprobado vía Wompi (transacción ${wompiTransactionId})`]
        )
      } else if (isFailure) {
        await conn.execute(
          `UPDATE orders
           SET payment_status = ?,
               payment_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newPaymentStatus, wompiTransactionId, order.id]
        )

        if (shouldRestore) {
          const [orderItems] = await conn.execute(
            'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
            [order.id]
          )
          for (const orderItem of orderItems) {
            await conn.execute(
              'UPDATE products SET stock = stock + ? WHERE id = ?',
              [orderItem.quantity, orderItem.product_id]
            )
            await conn.execute(
              `INSERT INTO stock_movements (product_id, type, quantity, reason, reference_type, reference_id, created_by)
               VALUES (?, 'in', ?, ?, 'order', ?, NULL)`,
              [
                orderItem.product_id,
                orderItem.quantity,
                `Restaurado por pago fallido (${wompiStatus}) pedido #${order.order_number}`,
                order.id,
              ]
            )
          }
        }

        if (wompiStatus === 'VOIDED') {
          await conn.execute(
            `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [order.id]
          )
        }

        await conn.execute(
          `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
           VALUES (?, ?, ?, NULL, ?)`,
          [
            order.id,
            order.status || 'pending',
            prevPaymentStatus,
            `Pago ${wompiStatus} vía Wompi (transacción ${wompiTransactionId})`,
          ]
        )
      }
    })

    if (shouldInvoice) {
      triggerInvoiceGeneration(order.id).catch((err) => {
        console.error(`Error generando factura para pedido ${order.id}:`, err)
      })
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    res.status(500).json({ error: 'Error procesando el webhook' })
  }
}

export async function getPaymentStatus(req, res) {
  try {
    const { id } = req.params
    const payment = await queryOne(
      'SELECT * FROM payments WHERE payment_id = ? OR reference = ? LIMIT 1',
      [id, id]
    )
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' })
    }
    res.json({ payment })
  } catch (error) {
    console.error('Get payment status error:', error)
    res.status(500).json({ error: 'Error al obtener estado de pago' })
  }
}
