import { query, queryOne, transaction } from '../config/database.js'
import slugify from 'slugify'
import { validationResult } from 'express-validator'
import cloudinary from '../config/cloudinary.js'

function generateSlug(name) {
  return slugify(name, { lower: true, strict: true })
}

async function calculateDiscount(price, originalPrice) {
  if (!originalPrice || originalPrice <= price) return 0
  return Math.round(((originalPrice - price) / originalPrice) * 100)
}

export async function adminGetProducts(req, res) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const search = req.query.search
    const categoryId = req.query.categoryId
    const brandId = req.query.brandId
    const status = req.query.status
    const featured = req.query.featured
    const onSale = req.query.onSale
    const lowStock = req.query.lowStock

    let sql = `
      SELECT p.*, c.name as category_name, b.name as brand_name,
             (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.deleted_at IS NULL
    `
    const params = []

    if (search) {
      sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.slug LIKE ?)'
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }
    if (categoryId) {
      sql += ' AND p.category_id = ?'
      params.push(categoryId)
    }
    if (brandId) {
      sql += ' AND p.brand_id = ?'
      params.push(brandId)
    }
    if (status === 'active') {
      sql += ' AND p.is_active = TRUE'
    } else if (status === 'inactive') {
      sql += ' AND p.is_active = FALSE'
    }
    if (featured === 'true') {
      sql += ' AND p.is_featured = TRUE'
    }
    if (onSale === 'true') {
      sql += ' AND p.is_on_sale = TRUE'
    }
    if (lowStock === 'true') {
      sql += ' AND p.stock <= p.min_stock AND p.stock > 0'
    }

    sql += ' ORDER BY p.created_at DESC'

    const countSql = sql.replace(
      'SELECT p.*, c.name as category_name, b.name as brand_name, (SELECT url FROM product_images WHERE product_id = p.id AND is_main = TRUE LIMIT 1) as main_image',
      'SELECT COUNT(*) as total'
    ).replace(/ORDER BY.*$/, '')

    const offset = (page - 1) * limit
    sql += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const [products, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSql, params.slice(0, -2)),
    ])

    const productsWithImages = await Promise.all(products.map(async (p) => {
      const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [p.id])
      return {
        ...p,
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      }
    }))

    res.json({
      products: productsWithImages,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Admin get products error:', error)
    res.status(500).json({ error: 'Error al obtener productos' })
  }
}

export async function adminGetProductById(req, res) {
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

    const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [id])

    res.json({
      product: {
        ...product,
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
        discount: product.original_price && product.price < product.original_price
          ? Math.round(((product.original_price - product.price) / product.original_price) * 100)
          : 0,
      },
    })
  } catch (error) {
    console.error('Admin get product error:', error)
    res.status(500).json({ error: 'Error al obtener producto' })
  }
}

export async function adminCreateProduct(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const {
      name, slug, sku, categoryId, brandId, shortDescription, description,
      specifications, features, warranty, price, originalPrice, costPrice,
      stock, minStock, weight, dimensions, isActive, isFeatured, isNew, isOnSale,
      saleStartsAt, saleEndsAt, metaTitle, metaDescription
    } = req.body

    const finalSlug = slug || generateSlug(name)
    const discount = await calculateDiscount(price, originalPrice)

    const result = await transaction(async (conn) => {
      const [productResult] = await conn.execute(
        `INSERT INTO products (
          category_id, brand_id, name, slug, sku, short_description, description,
          specifications, features, warranty, price, original_price, cost_price, discount_percent,
          stock, min_stock, weight, dimensions, is_active, is_featured, is_new, is_on_sale,
          sale_starts_at, sale_ends_at, meta_title, meta_description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          categoryId, brandId || null, name, finalSlug, sku,
          shortDescription || null, description || null,
          specifications ? JSON.stringify(specifications) : null,
          features ? JSON.stringify(features) : null,
          warranty || null, price, originalPrice || null, costPrice || null, discount,
          stock || 0, minStock || 5, weight || null, dimensions || null,
          isActive !== false, isFeatured || false, isNew || false, isOnSale || false,
          saleStartsAt || null, saleEndsAt || null, metaTitle || null, metaDescription || null
        ]
      )
      return productResult.insertId
    })

    const product = await queryOne(
      `SELECT p.*, c.name as category_name, b.name as brand_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.id = ?`,
      [result]
    )

    res.status(201).json({ product })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'SKU o slug ya existe' })
    }
    console.error('Admin create product error:', error)
    res.status(500).json({ error: 'Error al crear producto' })
  }
}

export async function adminUpdateProduct(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { id } = req.params
    const {
      name, slug, sku, categoryId, brandId, shortDescription, description,
      specifications, features, warranty, price, originalPrice, costPrice,
      stock, minStock, weight, dimensions, isActive, isFeatured, isNew, isOnSale,
      saleStartsAt, saleEndsAt, metaTitle, metaDescription
    } = req.body

    const finalSlug = slug || generateSlug(name)
    const discount = await calculateDiscount(price, originalPrice)

    const result = await transaction(async (conn) => {
      await conn.execute(
        `UPDATE products SET
          category_id = ?, brand_id = ?, name = ?, slug = ?, sku = ?,
          short_description = ?, description = ?, specifications = ?, features = ?,
          warranty = ?, price = ?, original_price = ?, cost_price = ?, discount_percent = ?,
          stock = ?, min_stock = ?, weight = ?, dimensions = ?,
          is_active = ?, is_featured = ?, is_new = ?, is_on_sale = ?,
          sale_starts_at = ?, sale_ends_at = ?, meta_title = ?, meta_description = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`,
        [
          categoryId, brandId || null, name, finalSlug, sku,
          shortDescription || null, description || null,
          specifications ? JSON.stringify(specifications) : null,
          features ? JSON.stringify(features) : null,
          warranty || null, price, originalPrice || null, costPrice || null, discount,
          stock || 0, minStock || 5, weight || null, dimensions || null,
          isActive !== false, isFeatured || false, isNew || false, isOnSale || false,
          saleStartsAt || null, saleEndsAt || null, metaTitle || null, metaDescription || null,
          id
        ]
      )
    })

    const product = await queryOne(
      `SELECT p.*, c.name as category_name, b.name as brand_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.id = ?`,
      [id]
    )

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const images = await query('SELECT id, url, alt_text, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order', [id])

    res.json({
      product: {
        ...product,
        images: images.map(img => ({ id: img.id, url: img.url, alt: img.alt_text, isMain: img.is_main, sortOrder: img.sort_order })),
      },
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'SKU o slug ya existe' })
    }
    console.error('Admin update product error:', error)
    res.status(500).json({ error: 'Error al actualizar producto' })
  }
}

export async function adminDeleteProduct(req, res) {
  try {
    const { id } = req.params

    await transaction(async (conn) => {
      await conn.execute('UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
    })

    res.json({ message: 'Producto eliminado correctamente' })
  } catch (error) {
    console.error('Admin delete product error:', error)
    res.status(500).json({ error: 'Error al eliminar producto' })
  }
}

export async function adminDuplicateProduct(req, res) {
  try {
    const { id } = req.params

    const original = await queryOne('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', [id])
    if (!original) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const newSku = `${original.sku}-COPY-${Date.now().toString(36).toUpperCase()}`
    const newSlug = `${original.slug}-copia-${Date.now().toString(36)}`

    const result = await transaction(async (conn) => {
      const [productResult] = await conn.execute(
        `INSERT INTO products (
          category_id, brand_id, name, slug, sku, short_description, description,
          specifications, features, warranty, price, original_price, cost_price, discount_percent,
          stock, min_stock, weight, dimensions, is_active, is_featured, is_new, is_on_sale,
          sale_starts_at, sale_ends_at, meta_title, meta_description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          original.category_id, original.brand_id,
          `${original.name} (Copia)`, newSlug, newSku,
          original.short_description, original.description,
          original.specifications ? JSON.stringify(original.specifications) : null,
          original.features ? JSON.stringify(original.features) : null,
          original.price, original.original_price, original.cost_price, original.discount_percent,
          0, original.min_stock, original.weight, original.dimensions,
          false, false, false, false,
          null, null, original.meta_title, original.meta_description
        ]
      )
      return productResult.insertId
    })

    const images = await query('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order', [id])
    if (images.length > 0) {
      for (const img of images) {
        await query(
          'INSERT INTO product_images (product_id, url, alt_text, is_main, sort_order) VALUES (?, ?, ?, ?, ?)',
          [result, img.url, img.alt_text, img.is_main, img.sort_order]
        )
      }
    }

    res.status(201).json({ message: 'Producto duplicado correctamente', productId: result })
  } catch (error) {
    console.error('Admin duplicate product error:', error)
    res.status(500).json({ error: 'Error al duplicar producto' })
  }
}

export async function adminToggleFeatured(req, res) {
  try {
    const { id } = req.params
    const product = await queryOne('SELECT is_featured FROM products WHERE id = ? AND deleted_at IS NULL', [id])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    await query('UPDATE products SET is_featured = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [!product.is_featured, id])
    res.json({ message: `Producto ${!product.is_featured ? 'marcado' : 'desmarcado'} como destacado` })
  } catch (error) {
    console.error('Admin toggle featured error:', error)
    res.status(500).json({ error: 'Error al cambiar estado destacado' })
  }
}

export async function adminToggleStatus(req, res) {
  try {
    const { id } = req.params
    const product = await queryOne('SELECT is_active FROM products WHERE id = ? AND deleted_at IS NULL', [id])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    await query('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [!product.is_active, id])
    res.json({ message: `Producto ${!product.is_active ? 'activado' : 'desactivado'}` })
  } catch (error) {
    console.error('Admin toggle status error:', error)
    res.status(500).json({ error: 'Error al cambiar estado' })
  }
}

export async function adminUploadImages(req, res) {
  try {
    const { id } = req.params
    const files = req.files

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron imágenes' })
    }

    const product = await queryOne('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL', [id])
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const existingMain = await queryOne('SELECT id FROM product_images WHERE product_id = ? AND is_main = TRUE', [id])

    const uploadedImages = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const uploadResult = await cloudinary.uploader.upload(file.path, {
        folder: `techstore/products/${id}`,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      })

      const isMain = !existingMain && i === 0
      const [result] = await query(
        'INSERT INTO product_images (product_id, url, alt_text, is_main, sort_order) VALUES (?, ?, ?, ?, ?)',
        [id, uploadResult.secure_url, file.originalname, isMain, i]
      )

      uploadedImages.push({ id: result.insertId, url: uploadResult.secure_url, isMain: isMain, sortOrder: i })
    }

    res.json({ images: uploadedImages })
  } catch (error) {
    console.error('Admin upload images error:', error)
    res.status(500).json({ error: 'Error al subir imágenes' })
  }
}

export async function adminDeleteImage(req, res) {
  try {
    const { id, imageId } = req.params

    const image = await queryOne('SELECT id, url, is_main FROM product_images WHERE id = ? AND product_id = ?', [imageId, id])
    if (!image) {
      return res.status(404).json({ error: 'Imagen no encontrada' })
    }

    // Delete from Cloudinary
    const publicId = image.url.split('/').slice(-2).join('/').replace(/\.[^/.]+$/, '')
    await cloudinary.uploader.destroy(`techstore/products/${id}/${publicId}`)

    await query('DELETE FROM product_images WHERE id = ?', [imageId])

    // If deleted was main, set first remaining as main
    if (image.is_main) {
      const nextImage = await queryOne('SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1', [id])
      if (nextImage) {
        await query('UPDATE product_images SET is_main = TRUE WHERE id = ?', [nextImage.id])
      }
    }

    res.json({ message: 'Imagen eliminada correctamente' })
  } catch (error) {
    console.error('Admin delete image error:', error)
    res.status(500).json({ error: 'Error al eliminar imagen' })
  }
}

export async function adminReorderImages(req, res) {
  try {
    const { id } = req.params
    const { imageIds } = req.body

    if (!Array.isArray(imageIds)) {
      return res.status(400).json({ error: 'imageIds debe ser un array' })
    }

    for (let i = 0; i < imageIds.length; i++) {
      await query('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', [i, imageIds[i], id])
    }

    res.json({ message: 'Orden de imágenes actualizado' })
  } catch (error) {
    console.error('Admin reorder images error:', error)
    res.status(500).json({ error: 'Error al reordenar imágenes' })
  }
}

export async function adminSetMainImage(req, res) {
  try {
    const { id, imageId } = req.params

    await query('UPDATE product_images SET is_main = FALSE WHERE product_id = ?', [id])
    await query('UPDATE product_images SET is_main = TRUE WHERE id = ? AND product_id = ?', [imageId, id])

    res.json({ message: 'Imagen principal actualizada' })
  } catch (error) {
    console.error('Admin set main image error:', error)
    res.status(500).json({ error: 'Error al establecer imagen principal' })
  }
}