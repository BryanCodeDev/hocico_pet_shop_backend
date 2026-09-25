import { query, queryOne, transaction } from '../config/database.js'
import * as factusService from '../utils/factusService.js'

async function loadOrderForInvoice(orderId) {
  const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId])
  const items = await query(
    `SELECT product_id, product_name, product_sku, quantity, unit_price, discount_price, subtotal
     FROM order_items WHERE order_id = ?`,
    [orderId]
  )
  return { order, items }
}

function factusHasErrors(resp) {
  const topErrors = resp?.errors
  const dataErrors = resp?.data?.errors
  const arr = Array.isArray(topErrors) ? topErrors : Array.isArray(dataErrors) ? dataErrors : []
  if (arr.length > 0) {
    const e = arr[0]
    return e?.detail || e?.message || e?.error || JSON.stringify(e)
  }
  return null
}

export async function generateInvoice(orderId, options = {}) {
  const { order, items } = await loadOrderForInvoice(orderId)
  if (!order) {
    const err = new Error('Pedido no encontrado')
    err.code = 'ORDER_NOT_FOUND'
    throw err
  }

  const existing = await queryOne(
    'SELECT id, status FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  )
  if (existing && existing.status === 'issued') {
    return { skipped: true, invoiceId: existing.id, status: 'issued' }
  }

  const payload = factusService.buildFactusPayload(order, items, options)

  let factusResp = null
  let invoiceData = {}
  let errorMessage = null

  try {
    factusResp = await factusService.createInvoice(payload)
    const errMsg = factusHasErrors(factusResp)
    invoiceData = factusService.extractFactusDocument(factusResp)

    if (errMsg) {
      errorMessage = errMsg
    } else if (invoiceData.status && String(invoiceData.status).toLowerCase() === 'error') {
      errorMessage = factusResp?.message || 'Factura rechazada por Factus'
    } else if (!invoiceData.invoiceNumber && !invoiceData.factusId) {
      errorMessage = 'Factus no devolvió respuesta válida'
    }
  } catch (e) {
    errorMessage = e.message || 'Error al generar la factura en Factus'
    factusResp = { error: true, message: errorMessage }
  }

  if (!errorMessage) {
    try {
      const details = await factusService.getInvoiceDetails(invoiceData.invoiceNumber || invoiceData.factusId)
      const det = factusService.extractFactusDocument(details)
      invoiceData = {
        factusId: invoiceData.factusId || det.factusId,
        invoiceNumber: invoiceData.invoiceNumber || det.invoiceNumber,
        cufe: invoiceData.cufe || det.cufe,
        pdfUrl: invoiceData.pdfUrl || det.pdfUrl,
        xmlUrl: invoiceData.xmlUrl || det.xmlUrl,
        status: invoiceData.status || det.status,
      }
    } catch (e) {
      // keep the data already extracted from the create response
    }
  }

  const invoice = await transaction(async (conn) => {
    if (errorMessage) {
      const factusReference =
        invoiceData.invoiceNumber || invoiceData.factusId || order.order_number

      const [r] = await conn.execute(
        `INSERT INTO invoices
          (order_id, factus_id, invoice_number, cufe, status, xml_url, pdf_url, factus_response, error_message)
         VALUES (?, ?, ?, ?, 'error', ?, ?, ?, ?)`,
        [
          orderId,
          invoiceData.factusId || null,
          factusReference,
          invoiceData.cufe || null,
          invoiceData.xmlUrl || null,
          invoiceData.pdfUrl || null,
          JSON.stringify(factusResp || {}),
          errorMessage,
        ]
      )

      await conn.execute(
        'UPDATE orders SET invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [r.insertId, orderId]
      )

      return { id: r.insertId, status: 'error', error_message: errorMessage }
    }

    const [r] = await conn.execute(
      `INSERT INTO invoices
        (order_id, factus_id, invoice_number, cufe, status, xml_url, pdf_url, factus_response, issued_at)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, NOW())`,
      [
        orderId,
        invoiceData.factusId || null,
        invoiceData.invoiceNumber || order.order_number,
        invoiceData.cufe || null,
        invoiceData.xmlUrl || null,
        invoiceData.pdfUrl || null,
        JSON.stringify(factusResp || {}),
      ]
    )

    await conn.execute(
      'UPDATE orders SET invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [r.insertId, orderId]
    )

    return {
      id: r.insertId,
      status: 'issued',
      factusId: invoiceData.factusId,
      invoiceNumber: invoiceData.invoiceNumber,
      cufe: invoiceData.cufe,
      pdfUrl: invoiceData.pdfUrl,
      xmlUrl: invoiceData.xmlUrl,
    }
  })

  return invoice
}

export async function triggerInvoiceGeneration(orderId) {
  try {
    const result = await generateInvoice(orderId)
    if (result.status === 'issued') {
      console.log(`✅ Factura generada (id ${result.id}) para pedido ${orderId}`)
    } else if (result.status === 'error') {
      console.warn(`⚠️ Factura en error para pedido ${orderId}: ${result.error_message}`)
    } else if (result.skipped) {
      console.log(`ℹ️ Pedido ${orderId}: factura ya emitida, se omite`)
    }
    return result
  } catch (e) {
    console.error(`Error generando factura para pedido ${orderId}:`, e)
    return null
  }
}

export async function getInvoice(req, res) {
  try {
    const { orderId } = req.params
    const row = await queryOne(
      `SELECT o.id, o.order_number, o.total, o.currency, o.payment_method, o.payment_status, o.customer_name,
              o.customer_email, o.customer_document_type, o.customer_document_number,
              i.id AS invoice_id, i.factus_id, i.invoice_number, i.cufe, i.status AS invoice_status,
              i.xml_url, i.pdf_url, i.error_message, i.issued_at, i.created_at
       FROM orders o
       LEFT JOIN invoices i ON o.invoice_id = i.id
       WHERE o.id = ?`,
      [orderId]
    )
    if (!row) {
      return res.status(404).json({ error: 'Pedido no encontrado' })
    }

    const invoice = row.invoice_id
      ? {
          id: row.invoice_id,
          factusId: row.factus_id,
          invoiceNumber: row.invoice_number,
          cufe: row.cufe,
          status: row.invoice_status,
          xmlUrl: row.xml_url,
          pdfUrl: row.pdf_url,
          errorMessage: row.error_message,
          issuedAt: row.issued_at,
          createdAt: row.created_at,
        }
      : null

    res.json({ order: { id: row.id, orderNumber: row.order_number, total: row.total, currency: row.currency }, invoice })
  } catch (error) {
    console.error('Get invoice error:', error)
    res.status(500).json({ error: 'Error al obtener la factura' })
  }
}

export async function retryInvoice(req, res) {
  try {
    const { orderId } = req.params
    const result = await generateInvoice(Number(orderId))
    if (result.status === 'issued') {
      return res.json({ message: 'Factura generada correctamente', invoice: result })
    }
    return res.status(422).json({
      error: 'No se pudo generar la factura',
      detail: result.error_message || 'Respuesta inesperada de Factus',
    })
  } catch (error) {
    if (error.code === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ error: error.message })
    }
    console.error('Retry invoice error:', error)
    res.status(500).json({ error: 'Error al reintentar la generación de la factura' })
  }
}

export async function downloadDocument(req, res) {
  try {
    const { orderId, docType } = req.params
    if (!['pdf', 'xml'].includes(docType)) {
      return res.status(400).json({ error: 'Tipo de documento inválido' })
    }

    const invoice = await queryOne(
      `SELECT i.factus_id, i.invoice_number, i.pdf_url, i.xml_url
       FROM invoices i
       JOIN orders o ON i.order_id = o.id
       WHERE o.id = ?
       ORDER BY i.id DESC LIMIT 1`,
      [orderId]
    )
    if (!invoice) {
      return res.status(404).json({ error: 'Factura no encontrada' })
    }

    let url = docType === 'pdf' ? invoice.pdf_url : invoice.xml_url
    if (!url || !url.startsWith('http')) {
      const number = invoice.invoice_number || invoice.factus_id
      if (!number) {
        return res.status(404).json({ error: 'No hay URL de documento disponible' })
      }
      url = `${factusService.FACTUS_BASE}/v1/invoices/${encodeURIComponent(number)}/${docType}`
    }

    const token = await factusService.getFactusToken()
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: docType === 'pdf' ? 'application/pdf' : 'application/xml',
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return res.status(502).json({ error: `Factus respondió ${response.status}: ${text}` })
    }

    const arrayBuffer = await response.arrayBuffer()
    res.set('Content-Type', docType === 'pdf' ? 'application/pdf' : 'application/xml')
    res.set('Content-Disposition', `inline; filename="${invoice.invoice_number || 'factura'}.${docType}"`)
    res.set('Content-Length', String(arrayBuffer.byteLength))
    res.send(Buffer.from(arrayBuffer))
  } catch (error) {
    console.error('Download document error:', error)
    res.status(500).json({ error: 'Error al descargar el documento' })
  }
}
