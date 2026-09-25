import { query, queryOne, transaction } from '../config/database.js'
import slugify from 'slugify'
import { validationResult } from 'express-validator'
import { mapProduct } from '../utils/helpers.js'

function generateSlug(name) {
  return slugify(name, { lower: true, strict: true })
}

function buildProductQuery(filters = {}) {
  let sql = `
    SELECT p.*, c.name as category_name, c.slug as category_slug,
           b.name as brand_name, b.slug as brand_slug,
           (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.deleted_at IS NULL
  `
  const params = []

  if (filters.category) {
    sql += ' AND c.slug = ?'
    params.push(filters.category)
  }
  if (filters.brand) {
    sql += ' AND b.slug = ?'
    params.push(filters.brand)
  }
  if (filters.search) {
    sql += ' AND MATCH(p.name, p.short_description, p.description) AGAINST(? IN BOOLEAN MODE)'
    params.push(filters.search + '*')
  }
  if (filters.minPrice !== undefined) {
    sql += ' AND p.price >= ?'
    params.push(filters.minPrice)
  }
  if (filters.maxPrice !== undefined) {
    sql += ' AND p.price <= ?'
    params.push(filters.maxPrice)
  }
  if (filters.onSale) {
    sql += ' AND p.is_on_sale = TRUE AND (p.sale_ends_at IS NULL OR p.sale_ends_at > NOW())'
  }
  if (filters.inStock) {
    sql += ' AND p.stock > 0'
  }
  if (filters.featured) {
    sql += ' AND p.is_featured = TRUE'
  }
  if (filters.isNew) {
    sql += ' AND p.is_new = TRUE'
  }
  if (filters.active !== undefined) {
    sql += ' AND p.is_active = ?'
    params.push(filters.active)
  }

  const sortMap = {
    'newest': 'p.created_at DESC',
    'price-asc': 'p.price ASC',
    'price-desc': 'p.price DESC',
    'best-sellers': 'p.id DESC', // TODO: join with order_items for real best sellers
    'name-asc': 'p.name ASC',
    'name-desc': 'p.name DESC',
  }
  sql += ` ORDER BY ${sortMap[filters.sort] || 'p.created_at DESC'}`

  const limit = Math.min(filters.limit || 12, 100)
  const offset = ((filters.page || 1) - 1) * limit
  sql += ` LIMIT ? OFFSET ?`
  params.push(limit, offset)

  return { sql, params, limit, offset }
}

export async function getProducts(req, res) {
  try {
    const filters = {
      category: req.query.category,
      brand: req.query.brand,
      search: req.query.search || req.query.q,
      minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined,
      onSale: req.query.onSale === 'true',
      inStock: req.query.inStock === 'true',
      featured: req.query.featured === 'true',
      isNew: req.query.new === 'true',
      active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined,
      sort: req.query.sort || 'newest',
      page: req.query.page ? parseInt(req.query.page) : 1,
      limit: req.query.limit ? parseInt(req.query.limit) : 12,
    }

    const { sql, params, limit, offset } = buildProductQuery(filters)

    const countSql = sql.replace(
      'SELECT p.*, c.name as category_name, c.slug as category_slug, b.name as brand_name, b.slug as brand_slug, (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image',
      'SELECT COUNT(*) as total'
    ).replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '')

    const [products, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSql, params.slice(0, -2)),
    ])

    const total = countResult?.total || 0
    const totalPages = Math.ceil(total / limit)

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      }
    }))

    res.json({
      products: productsWithImages,
      pagination: {
        page: filters.page,
        limit,
        total,
        totalPages,
        hasNext: filters.page < totalPages,
        hasPrev: filters.page > 1,
      },
    })
  } catch (error) {
    console.error('Get products error:', error)
    res.status(500).json({ error: 'Error al obtener productos' })
  }
}

export async function getProductBySlug(req, res) {
  try {
    const { slug } = req.params

    const product = await queryOne(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              b.name as brand_name, b.slug as brand_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.slug = ? AND p.deleted_at IS NULL`,
      [slug]
    )

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [product.id])

    const related = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.category_id = ? AND p.id != ? AND p.is_active = TRUE AND p.deleted_at IS NULL
       ORDER BY p.is_featured DESC, p.created_at DESC
       LIMIT 4`,
      [product.category_id, product.id]
    )

    res.json({
      product: {
        ...mapProduct(product),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      },
      related: related.map(p => mapProduct(p)),
    })
  } catch (error) {
    console.error('Get product error:', error)
    res.status(500).json({ error: 'Error al obtener producto' })
  }
}

export async function getProductById(req, res) {
  try {
    const { id } = req.params

    const product = await queryOne(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              b.name as brand_name, b.slug as brand_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id]
    )

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [product.id])

    res.json({
      product: {
        ...mapProduct(product),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      },
    })
  } catch (error) {
    console.error('Get product by id error:', error)
    res.status(500).json({ error: 'Error al obtener producto' })
  }
}

export async function getFeaturedProducts(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20)
    const products = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_featured = TRUE AND p.is_active = TRUE AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [limit]
    )

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      }
    }))

    res.json({ products: productsWithImages })
  } catch (error) {
    console.error('Get featured products error:', error)
    res.status(500).json({ error: 'Error al obtener productos destacados' })
  }
}

export async function getOnSaleProducts(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20)
    const products = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_on_sale = TRUE AND p.is_active = TRUE AND p.deleted_at IS NULL
       AND (p.sale_ends_at IS NULL OR p.sale_ends_at > NOW())
       ORDER BY p.discount_percent DESC, p.created_at DESC
       LIMIT ?`,
      [limit]
    )

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      }
    }))

    res.json({ products: productsWithImages })
  } catch (error) {
    console.error('Get on sale products error:', error)
    res.status(500).json({ error: 'Error al obtener ofertas' })
  }
}

export async function getNewArrivals(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 8, 20)
    const products = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_new = TRUE AND p.is_active = TRUE AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [limit]
    )

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
              }
    }))

    res.json({ products: productsWithImages })
  } catch (error) {
    console.error('Get new arrivals error:', error)
    res.status(500).json({ error: 'Error al obtener novedades' })
  }
}

export async function searchProducts(req, res) {
  try {
    const { q } = req.query
    if (!q || q.trim().length < 2) {
      return res.json({ products: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } })
    }

    req.query.search = q.trim()
    return getProducts(req, res)
  } catch (error) {
    console.error('Search products error:', error)
    res.status(500).json({ error: 'Error en la búsqueda' })
  }
}

export async function getRelatedProducts(req, res) {
  try {
    const { id } = req.params
    const limit = Math.min(parseInt(req.query.limit) || 4, 10)

    const product = await queryOne('SELECT category_id FROM products WHERE id = ?', [id])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const related = await query(
      `SELECT p.*, c.slug as category_slug,
              (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.category_id = ? AND p.id != ? AND p.is_active = TRUE AND p.deleted_at IS NULL
       ORDER BY p.is_featured DESC, p.created_at DESC
       LIMIT ?`,
      [product.category_id, id, limit]
    )

    const productsWithImages = await Promise.all(related.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...mapProduct(p),
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
              }
    }))

    res.json({ products: productsWithImages })
  } catch (error) {
    console.error('Get related products error:', error)
    res.status(500).json({ error: 'Error al obtener productos relacionados' })
  }
}