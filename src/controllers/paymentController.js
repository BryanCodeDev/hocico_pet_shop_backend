import { query, queryOne, transaction } from '../config/database.js'
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'
import { validationResult } from 'express-validator'

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
const preference = new Preference(client)
const paymentClient = new Payment(client)

export async function createPreference(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { orderId, payer, backUrls } = req.body

    const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId])
    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }

    if (order.payment_status === 'approved') {
      return res.status(400).json({ error: 'El pedido ya fue pagado' })
    }

    const items = await query(
      `SELECT oi.*, p.name FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    )

    const preferenceData = {
      items: items.map(item => ({
        id: item.product_id.toString(),
        title: item.product_name,
        quantity: item.quantity,
        unit_price: parseFloat(item.discount_price || item.unit_price),
        currency_id: 'ARS',
      })),
      payer: {
        name: payer?.name || order.customer_name.split(' ')[0],
        surname: payer?.surname || order.customer_name.split(' ').slice(1).join(' ') || '',
        email: payer?.email || order.customer_email,
        phone: payer?.phone ? { number: payer.phone.replace(/\D/g, '') } : undefined,
      },
      back_urls: backUrls || {
        success: `${process.env.FRONTEND_URL}/checkout/success?order=${order.order_number}`,
        failure: `${process.env.FRONTEND_URL}/checkout/failure?order=${order.order_number}`,
        pending: `${process.env.FRONTEND_URL}/checkout/pending?order=${order.order_number}`,
      },
      auto_return: 'approved',
      external_reference: order.order_number,
      notification_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
      statement_descriptor: 'TechStore',
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }

    const response = await preference.create({ body: preferenceData })

    await query('UPDATE orders SET payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [response.id, orderId])

    res.json({
      preferenceId: response.id,
      initPoint: response.init_point,
      sandboxInitPoint: response.sandbox_init_point,
    })
  } catch (error) {
    console.error('Create preference error:', error)
    res.status(500).json({ error: 'Error al crear preferencia de pago' })
  }
}

export async function webhook(req, res) {
  try {
    const { type, data } = req.body

    if (type === 'payment') {
      const paymentId = data.id
      const payment = await paymentClient.get({ id: paymentId })

      if (!payment) {
        return res.status(400).json({ error: 'Pago no encontrado' })
      }

      const paymentData = payment
      const externalReference = paymentData.external_reference

      const order = await queryOne('SELECT * FROM orders WHERE order_number = ?', [externalReference])
      if (!order) {
        return res.status(404).json({ error: 'Pedido no encontrado' })
      }

      if (order.payment_status === 'approved' && paymentData.status === 'approved') {
        return res.status(200).json({ message: 'Pago ya procesado' })
      }

      const shouldProcess = paymentData.status === 'approved' || paymentData.status === 'rejected' || paymentData.status === 'cancelled'

      if (shouldProcess) {
        await transaction(async (conn) => {
          await conn.execute(
            `INSERT INTO payments (order_id, payment_id, payment_method_id, payment_type, status, status_detail, amount, currency, fee, net_amount, payer_email, payer_id, external_reference, raw_data, processed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status), status_detail = VALUES(status_detail), processed_at = NOW()`,
            [
              order.id, paymentData.id, paymentData.payment_method_id, paymentData.payment_type_id,
              paymentData.status, paymentData.status_detail, paymentData.transaction_amount, paymentData.currency_id,
              paymentData.fee_details?.[0]?.amount || 0, paymentData.transaction_amount - (paymentData.fee_details?.[0]?.amount || 0),
              paymentData.payer?.email, paymentData.payer?.id, externalReference, JSON.stringify(paymentData)
            ]
          )

          if (paymentData.status === 'approved') {
            await conn.execute('UPDATE orders SET payment_status = ?, payment_id = ?, paid_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['approved', paymentData.id, order.id])
            await conn.execute(
              `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
               VALUES (?, 'paid', 'pending', NULL, 'Pago aprobado via Mercado Pago')`,
              [order.id]
            )
          } else if (paymentData.status === 'rejected') {
            await conn.execute('UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['rejected', order.id])
            await conn.execute(
              `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
               VALUES (?, 'pending', 'pending', NULL, 'Pago rechazado: ${paymentData.status_detail}')`,
              [order.id]
            )
          } else if (paymentData.status === 'cancelled') {
            await conn.execute('UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['cancelled', order.id])
            await conn.execute(
              `INSERT INTO order_status_history (order_id, status, previous_status, changed_by, notes)
               VALUES (?, 'cancelled', 'pending', NULL, 'Pago cancelado por el usuario')`,
              [order.id]
            )
            const items = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [order.id])
            for (const item of items[0]) {
              await conn.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id])
            }
          }
        })
      }
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    res.status(500).json({ error: 'Error procesando webhook' })
  }
}

export async function getPaymentStatus(req, res) {
  try {
    const { id } = req.params

    const payment = await queryOne('SELECT * FROM payments WHERE payment_id = ?', [id])
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' })
    }

    res.json({ payment })
  } catch (error) {
    console.error('Get payment status error:', error)
    res.status(500).json({ error: 'Error al obtener estado de pago' })
  }
}