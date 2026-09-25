import 'dotenv/config'

export const FACTUS_BASE = process.env.FACTUS_BASE_URL || 'https://api.factus.com.co'

let cachedToken = null
let tokenExpiresAt = 0

function buildAuthBody() {
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.FACTUS_CLIENT_ID || '',
    client_secret: process.env.FACTUS_CLIENT_SECRET || '',
    username: process.env.FACTUS_EMAIL || '',
    password: process.env.FACTUS_PASSWORD || '',
  })
  return params.toString()
}

export async function getFactusToken(forceRefresh = false) {
  const now = Date.now() / 1000
  if (!forceRefresh && cachedToken && tokenExpiresAt - now > 60) {
    return cachedToken
  }

  const res = await fetch(`${FACTUS_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: buildAuthBody(),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data?.message || data?.error?.description || JSON.stringify(data)
    throw new Error(`Factus: error de autenticación (${res.status}): ${detail}`)
  }

  const token =
    data?.access_token ||
    data?.data?.token ||
    data?.token ||
    data?.data?.access_token

  if (!token) {
    throw new Error('Factus: no se obtuvo el token de autenticación')
  }

  cachedToken = token
  const expiresIn = Number(data?.expires_in || data?.data?.expires_in || 3600)
  tokenExpiresAt = now + expiresIn
  return token
}

export async function factusRequest(path, { method = 'GET', body } = {}) {
  const token = await getFactusToken()
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(`${FACTUS_BASE}${path}`, options)
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const detail = data?.message || data?.error?.message || data?.detail || JSON.stringify(data)
    const err = new Error(`Factus API (${res.status}): ${detail}`)
    err.status = res.status
    err.response = data
    throw err
  }

  return data
}

export async function createInvoice(payload) {
  return factusRequest('/v1/invoices', { method: 'POST', body: payload })
}

export async function getInvoiceDetails(invoiceNumber) {
  if (!invoiceNumber) return null
  return factusRequest(`/v1/invoices/${encodeURIComponent(invoiceNumber)}`)
}

function firstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

function firstUrl(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.startsWith('http')) return v
  }
  return null
}

export function extractFactusDocument(data) {
  const d = data?.data || data || {}
  return {
    factusId: firstNonEmpty(d, ['factus_id', 'id', 'number', 'identifier']),
    invoiceNumber: firstNonEmpty(d, ['invoice_number', 'number']),
    cufe: firstNonEmpty(d, ['cufe']),
    pdfUrl: firstUrl(d, ['pdf_url', 'url_pdf', 'pdf']),
    xmlUrl: firstUrl(d, ['xml_url', 'url_xml', 'xml']),
    status: firstNonEmpty(d, ['status', 'state']),
  }
}

const DOCUMENT_TYPE_MAP = {
  CC: 'CC',
  NIT: 'NIT',
  CE: 'CE',
  PASSPORT: 'PP',
}

export function mapDocumentType(type) {
  return DOCUMENT_TYPE_MAP[type] || type
}

export function buildFactusPayload(order, orderItems, opts = {}) {
  const numberingRangeId = Number(
    opts.numberingRangeId ?? process.env.FACTUS_NUMBERING_RANGE_ID ?? 8
  )
  const municipalityId = Number(
    opts.municipalityId ?? process.env.FACTUS_MUNICIPALITY_ID ?? 1101
  )
  const iva = Number(opts.iva ?? process.env.FACTUS_IVA ?? 19)
  const paymentForm = order.payment_method === 'bank_transfer' ? '19' : '1'

  const fullName = order.customer_name || ''
  const nameParts = fullName.trim().split(/\s+/)
  const names = nameParts.shift() || ''
  const surnames = nameParts.join(' ')

  return {
    numbering_range_id: numberingRangeId,
    customer: {
      identification_number: order.customer_document_number || '',
      identification_type: mapDocumentType(order.customer_document_type),
      names,
      surnames,
      email: order.customer_email,
      phone: order.customer_phone,
      address: order.address,
      city: order.city,
      municipality_id: municipalityId,
      legal_organization: order.customer_document_type === 'NIT' ? 'Persona jurídica' : 'Persona natural',
      responsible_type: order.customer_document_type === 'NIT' ? 'Sí' : 'No',
      tribute_effective: 'No',
    },
    items: (orderItems || []).map((oi) => ({
      code: oi.product_sku || `PROD-${oi.product_id}`,
      name: oi.product_name,
      quantity: Number(oi.quantity),
      unit_price: Number(oi.unit_price),
      discount: Number(oi.discount_price || 0),
      tax: iva,
      type: 'PRODUCT',
      unit: 'Unidad',
    })),
    payment_forms: [
      {
        form: paymentForm,
        method: paymentForm,
        value: Number(order.total),
      },
    ],
  }
}
