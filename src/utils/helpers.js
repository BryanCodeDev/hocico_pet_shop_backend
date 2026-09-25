export function mapProduct(p) {
  if (!p) return null
  return {
    ...p,
    id: p.id,
    category_id: p.category_id,
    category: p.category_name || p.category,
    categorySlug: p.category_slug,
    brand: p.brand_name || p.brand,
    brandId: p.brand_id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    shortDescription: p.short_description,
    description: p.description,
    price: p.price,
    originalPrice: p.original_price,
    discountPercent: p.discount_percent,
    costPrice: p.cost_price,
    stock: p.stock,
    minStock: p.min_stock,
    isActive: p.is_active,
    isFeatured: p.is_featured,
    isNew: p.is_new,
    isOnSale: p.is_on_sale,
    discount: p.original_price && p.price < p.original_price
      ? Math.round(((p.original_price - p.price) / p.original_price) * 100)
      : 0,
    mainImage: p.main_image,
    images: p.images || [],
  }
}

export function formatPrice(price, currency = 'COP', locale = 'es-CO') {
  if (price === null || price === undefined) return '$0'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

export function generateOrderNumber() {
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `ORD-${year}${month}${day}-${random}`
}

export function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function generateSKU(category, brand) {
  const cat = category.slice(0, 3).toUpperCase()
  const br = brand.slice(0, 3).toUpperCase()
  const num = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${cat}-${br}-${num}`
}

export function calculateDiscount(originalPrice, currentPrice) {
  if (!originalPrice || originalPrice <= currentPrice) return 0
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
}

export function getStockStatus(stock, minStock = 5) {
  if (stock <= 0) return { label: 'Agotado', available: false, level: 'out' }
  if (stock <= minStock) return { label: `Stock bajo (${stock})`, available: true, level: 'low' }
  return { label: 'Disponible', available: true, level: 'ok' }
}

export function getOrderStatusConfig(status) {
  const configs = {
    pending: { label: 'Pendiente', color: 'gold' },
    paid: { label: 'Pagado', color: 'blue' },
    preparing: { label: 'Preparando', color: 'purple' },
    shipped: { label: 'Enviado', color: 'indigo' },
    delivered: { label: 'Entregado', color: 'green' },
    cancelled: { label: 'Cancelado', color: 'red' },
    refunded: { label: 'Reembolsado', color: 'gray' },
  }
  return configs[status] || configs.pending
}

export function getPaymentStatusConfig(status) {
  const configs = {
    pending: { label: 'Pendiente', color: 'gold' },
    approved: { label: 'Aprobado', color: 'green' },
    rejected: { label: 'Rechazado', color: 'red' },
    cancelled: { label: 'Cancelado', color: 'gray' },
    refunded: { label: 'Reembolsado', color: 'blue' },
    in_process: { label: 'En proceso', color: 'blue' },
    in_mediation: { label: 'En mediación', color: 'purple' },
    charged_back: { label: 'Contracargo', color: 'red' },
  }
  return configs[status] || configs.pending
}

export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

export function sanitizeInput(input) {
  if (typeof input !== 'string') return input
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
}

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}