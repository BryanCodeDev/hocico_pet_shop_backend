import { body, param, query, validationResult } from 'express-validator'

export const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

export const registerValidation = [
  body('firstName').trim().notEmpty().withMessage('Nombre es requerido').isLength({ max: 100 }),
  body('lastName').trim().notEmpty().withMessage('Apellido es requerido').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
  body('phone').optional().trim().isMobilePhone('es-CO').withMessage('Teléfono inválido'),
  validate,
]

export const loginValidation = [
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('password').notEmpty().withMessage('Contraseña es requerida'),
  validate,
]

export const updateProfileValidation = [
  body('firstName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('lastName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional().trim().isMobilePhone('es-CO').withMessage('Teléfono inválido'),
  body('address').optional().trim().isLength({ max: 500 }),
  body('city').optional().trim().isLength({ max: 100 }),
  body('province').optional().trim().isLength({ max: 100 }),
  validate,
]

export const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Contraseña actual es requerida'),
  body('newPassword').isLength({ min: 8 }).withMessage('La nueva contraseña debe tener al menos 8 caracteres'),
  validate,
]

export const productValidation = [
  body('name').trim().notEmpty().withMessage('Nombre es requerido').isLength({ max: 255 }),
  body('slug').trim().notEmpty().withMessage('Slug es requerido').isLength({ max: 280 }),
  body('sku').trim().notEmpty().withMessage('SKU es requerido').isLength({ max: 100 }),
  body('categoryId').isInt({ min: 1 }).withMessage('Categoría inválida'),
  body('brandId').optional().isInt({ min: 1 }),
  body('price').isFloat({ min: 0 }).withMessage('Precio inválido'),
  body('originalPrice').optional().isFloat({ min: 0 }),
  body('stock').isInt({ min: 0 }).withMessage('Stock inválido'),
  body('shortDescription').optional().trim().isLength({ max: 500 }),
  body('description').optional().trim(),
  body('specifications').optional().isObject(),
  body('features').optional().isArray(),
  body('warranty').optional().trim(),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
  body('isNew').optional().isBoolean(),
  body('isOnSale').optional().isBoolean(),
  body('saleStartsAt').optional().isISO8601(),
  body('saleEndsAt').optional().isISO8601(),
  body('metaTitle').optional().trim().isLength({ max: 200 }),
  body('metaDescription').optional().trim().isLength({ max: 300 }),
  validate,
]

export const categoryValidation = [
  body('name').trim().notEmpty().withMessage('Nombre es requerido').isLength({ max: 100 }),
  body('slug').trim().notEmpty().withMessage('Slug es requerido').isLength({ max: 120 }),
  body('description').optional().trim(),
  body('imageUrl').optional().isURL(),
  body('parentId').optional().isInt({ min: 1 }),
  body('seoTitle').optional().trim().isLength({ max: 200 }),
  body('seoDescription').optional().trim().isLength({ max: 300 }),
  body('isActive').optional().isBoolean(),
  body('sortOrder').optional().isInt({ min: 0 }),
  validate,
]

export const orderValidation = [
  body('customerName').trim().notEmpty().withMessage('Nombre es requerido').isLength({ max: 200 }),
  body('customerEmail').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('customerPhone').trim().notEmpty().withMessage('Teléfono es requerido'),
  body('address').trim().notEmpty().withMessage('Dirección es requerida'),
  body('city').trim().notEmpty().withMessage('Ciudad es requerida'),
  body('province').trim().notEmpty().withMessage('Provincia es requerida'),
  body('notes').optional().trim(),
  body('items').isArray({ min: 1 }).withMessage('El pedido debe tener al menos un producto'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad inválida'),
  body('paymentMethod').isIn(['mercadopago', 'whatsapp', 'bank_transfer', 'cash_on_delivery']).withMessage('Método de pago inválido'),
  validate,
]

export const cartValidation = [
  body('productId').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('quantity').isInt({ min: 1 }).withMessage('Cantidad inválida'),
  validate,
]

export const idParamValidation = [
  param('id').isInt({ min: 1 }).withMessage('ID inválido'),
  validate,
]

export const slugParamValidation = [
  param('slug').trim().notEmpty().withMessage('Slug requerido'),
  validate,
]

export const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sort').optional().trim(),
  query('order').optional().isIn(['ASC', 'DESC']),
  validate,
]