import { query, queryOne, transaction } from '../config/database.js'
import slugify from 'slugify'
import { validationResult } from 'express-validator'
import cloudinary from '../config/cloudinary.js'
import { mapCategory } from '../utils/helpers.js'

function generateSlug(name) {
  return slugify(name, { lower: true, strict: true })
}

// Cuenta los productos de la categoría y los de sus subcategorías directas,
// para que una categoría raíz (p. ej. "Alimentos") no aparezca con 0 productos
// cuando su catálogo real cuelga de "Alimento para Perro/Gato".
const PRODUCT_COUNT_SQL = `
  (SELECT COUNT(*)
     FROM products p
     JOIN categories pc ON pc.id = p.category_id
    WHERE p.is_active = TRUE
      AND p.deleted_at IS NULL
      AND pc.deleted_at IS NULL
      AND (pc.id = c.id OR pc.parent_id = c.id)) as product_count
`

export async function getCategories(req, res) {
  try {
    const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined
    const parentId = req.query.parentId
    const withProducts = req.query.withProducts === 'true'

    let sql = `
      SELECT c.*,
             ${PRODUCT_COUNT_SQL}
      FROM categories c
      WHERE c.deleted_at IS NULL
    `
    const params = []

    if (active !== undefined) {
      sql += ' AND c.is_active = ?'
      params.push(active)
    }
    if (parentId) {
      sql += ' AND c.parent_id = ?'
      params.push(parentId)
    } else if (req.query.root === 'true') {
      sql += ' AND c.parent_id IS NULL'
    }

    sql += ' ORDER BY c.sort_order, c.name'

    const categories = await query(sql, params)

    if (withProducts) {
      for (const cat of categories) {
        cat.products = await query(
          `SELECT p.*, (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
           FROM products p
           WHERE p.is_active = TRUE AND p.deleted_at IS NULL
             AND p.category_id IN (
               SELECT cc.id FROM categories cc
                WHERE cc.deleted_at IS NULL AND (cc.id = ? OR cc.parent_id = ?)
             )
           ORDER BY p.is_featured DESC, p.created_at DESC
           LIMIT 8`,
          [cat.id, cat.id]
        )
      }
    }

    res.json({ categories: categories.map(mapCategory) })
  } catch (error) {
    console.error('Get categories error:', error)
    res.status(500).json({ error: 'Error al obtener categorías' })
  }
}

export async function getCategoryBySlug(req, res) {
  try {
    const { slug } = req.params

    const category = await queryOne(
      `SELECT c.*,
              ${PRODUCT_COUNT_SQL}
       FROM categories c
       WHERE c.slug = ? AND c.deleted_at IS NULL`,
      [slug]
    )

    if (!category) {
      return res.status(404).json({ error: 'Categoría no encontrada' })
    }

    const subcategories = await query(
      'SELECT * FROM categories WHERE parent_id = ? AND is_active = TRUE AND deleted_at IS NULL ORDER BY sort_order, name',
      [category.id]
    )

    const products = await query(
      `SELECT p.*, (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
       FROM products p
       WHERE p.is_active = TRUE AND p.deleted_at IS NULL
         AND p.category_id IN (
           SELECT cc.id FROM categories cc
            WHERE cc.deleted_at IS NULL AND (cc.id = ? OR cc.parent_id = ?)
         )
       ORDER BY p.is_featured DESC, p.created_at DESC`,
      [category.id, category.id]
    )

    res.json({
      category: mapCategory(category),
      subcategories: subcategories.map(mapCategory),
      products,
    })
  } catch (error) {
    console.error('Get category error:', error)
    res.status(500).json({ error: 'Error al obtener categoría' })
  }
}

export async function getCategoryProducts(req, res) {
  try {
    const { slug } = req.params
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 12, 100)
    const sort = req.query.sort || 'newest'
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : undefined
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined
    const onSale = req.query.onSale === 'true'
    const inStock = req.query.inStock === 'true'
    const brand = req.query.brand

    const category = await queryOne('SELECT id FROM categories WHERE slug = ? AND deleted_at IS NULL', [slug])
    if (!category) {
      return res.status(404).json({ error: 'Categoría no encontrada' })
    }

    // El alcance incluye la categoría y sus subcategorías directas, para que
    // "/categoria/alimentos" muestre también lo de Perro y Gato.
    const whereConditions = [
      'p.is_active = TRUE',
      'p.deleted_at IS NULL',
      'p.category_id IN (SELECT cc.id FROM categories cc WHERE cc.deleted_at IS NULL AND (cc.id = ? OR cc.parent_id = ?))',
    ]
    const params = [category.id, category.id]

    if (minPrice !== undefined) {
      whereConditions.push('p.price >= ?')
      params.push(minPrice)
    }
    if (maxPrice !== undefined) {
      whereConditions.push('p.price <= ?')
      params.push(maxPrice)
    }
    if (onSale) {
      whereConditions.push('p.is_on_sale = TRUE AND (p.sale_ends_at IS NULL OR p.sale_ends_at > NOW())')
    }
    if (inStock) {
      whereConditions.push('p.stock > 0')
    }
    if (brand) {
      whereConditions.push('p.brand_id = (SELECT id FROM brands WHERE slug = ?)')
      params.push(brand)
    }

    const sortMap = {
      'newest': 'p.created_at DESC',
      'price-asc': 'p.price ASC',
      'price-desc': 'p.price DESC',
      'best-sellers': 'p.id DESC',
      'name-asc': 'p.name ASC',
      'name-desc': 'p.name DESC',
    }
    const orderBy = sortMap[sort] || 'p.created_at DESC'
    const whereClause = whereConditions.join(' AND ')

    const fromSql = `
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${whereClause}
    `

    // El count se construye aparte (no con .replace() sobre el SQL de
    // productos): el replace anterior no coincidía por los saltos de línea del
    // template y devolvía la primera fila del producto en vez del conteo,
    // dejando pagination.total siempre en 0.
    const countSql = `SELECT COUNT(*) as total ${fromSql}`
    const listSql = `
      SELECT p.*, c.slug as category_slug,
             (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
      ${fromSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `

    const offset = (page - 1) * limit
    const listParams = [...params, limit, offset]

    const [products, countResult] = await Promise.all([
      query(listSql, listParams),
      queryOne(countSql, params),
    ])

    const total = countResult?.total || 0

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...p,
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
        discount: p.original_price && p.price < p.original_price
          ? Math.round(((p.original_price - p.price) / p.original_price) * 100)
          : 0,
      }
    }))

    res.json({
      products: productsWithImages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get category products error:', error)
    res.status(500).json({ error: 'Error al obtener productos de la categoría' })
  }
}

export async function adminGetCategories(req, res) {
  try {
    const categories = await query(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) as product_count
       FROM categories c
       WHERE c.deleted_at IS NULL
       ORDER BY c.sort_order, c.name`
    )

    res.json({ categories: categories.map(mapCategory) })
  } catch (error) {
    console.error('Admin get categories error:', error)
    res.status(500).json({ error: 'Error al obtener categorías' })
  }
}

export async function adminCreateCategory(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { name, slug, description, imageUrl, parentId, seoTitle, seoDescription, isActive, sortOrder } = req.body

    const finalSlug = slug || generateSlug(name)

    let image_url = imageUrl
    if (req.file) {
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: 'hocico/categories',
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      })
      image_url = uploadResult.secure_url
    }

    const result = await transaction(async (conn) => {
      const [catResult] = await conn.execute(
        `INSERT INTO categories (name, slug, description, image_url, parent_id, seo_title, seo_description, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, finalSlug, description || null, image_url || null, parentId || null, seoTitle || null, seoDescription || null, isActive !== false, sortOrder || 0]
      )
      return catResult.insertId
    })

    const category = await queryOne('SELECT * FROM categories WHERE id = ?', [result])
    res.status(201).json({ category: mapCategory(category) })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Nombre o slug ya existe' })
    }
    console.error('Admin create category error:', error)
    res.status(500).json({ error: 'Error al crear categoría' })
  }
}

export async function adminUpdateCategory(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { id } = req.params
    const { name, slug, description, imageUrl, parentId, seoTitle, seoDescription, isActive, sortOrder } = req.body

    const finalSlug = slug || generateSlug(name)

    let image_url = imageUrl
    if (req.file) {
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: 'hocico/categories',
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      })
      image_url = uploadResult.secure_url
    }

    await transaction(async (conn) => {
      await conn.execute(
        `UPDATE categories SET
          name = ?, slug = ?, description = ?, image_url = ?, parent_id = ?,
          seo_title = ?, seo_description = ?, is_active = ?, sort_order = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`,
        [name, finalSlug, description || null, image_url || null, parentId || null, seoTitle || null, seoDescription || null, isActive !== false, sortOrder || 0, id]
      )
    })

    const category = await queryOne('SELECT * FROM categories WHERE id = ?', [id])
    if (!category) {
      return res.status(404).json({ error: 'Categoría no encontrada' })
    }

    res.json({ category: mapCategory(category) })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Nombre o slug ya existe' })
    }
    console.error('Admin update category error:', error)
    res.status(500).json({ error: 'Error al actualizar categoría' })
  }
}

export async function adminDeleteCategory(req, res) {
  try {
    const { id } = req.params

    const productCount = await queryOne('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND deleted_at IS NULL', [id])
    if (productCount.count > 0) {
      return res.status(400).json({ error: 'No se puede eliminar una categoría con productos' })
    }

    const childrenCount = await queryOne('SELECT COUNT(*) as count FROM categories WHERE parent_id = ? AND deleted_at IS NULL', [id])
    if (childrenCount.count > 0) {
      return res.status(400).json({ error: 'No se puede eliminar una categoría con subcategorías' })
    }

    await transaction(async (conn) => {
      await conn.execute('UPDATE categories SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
    })

    res.json({ message: 'Categoría eliminada correctamente' })
  } catch (error) {
    console.error('Admin delete category error:', error)
    res.status(500).json({ error: 'Error al eliminar categoría' })
  }
}

export async function adminToggleStatus(req, res) {
  try {
    const { id } = req.params
    const category = await queryOne('SELECT is_active FROM categories WHERE id = ? AND deleted_at IS NULL', [id])
    if (!category) {
      return res.status(404).json({ error: 'Categoría no encontrada' })
    }

    await query('UPDATE categories SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [!category.is_active, id])
    res.json({ message: `Categoría ${!category.is_active ? 'activada' : 'desactivada'}` })
  } catch (error) {
    console.error('Admin toggle category status error:', error)
    res.status(500).json({ error: 'Error al cambiar estado' })
  }
}