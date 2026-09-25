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
  body('province').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('department').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('province').custom((value, { req }) => {
    if (!value && !req.body.department) {
      throw new Error('Provincia es requerida')
    }
    return true
  }),
  body('notes').optional().trim(),
  body('items').isArray({ min: 1 }).withMessage('El pedido debe tener al menos un producto'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad inválida'),
  body('paymentMethod').isIn(['wompi', 'mercadopago', 'whatsapp', 'bank_transfer', 'cash_on_delivery']).withMessage('Método de pago inválido'),
  body('customerDocumentType').optional().isIn(['CC', 'NIT', 'CE', 'PASSPORT']).withMessage('Tipo de documento inválido'),
  body('customerDocumentNumber').optional().trim().notEmpty().withMessage('Número de documento es requerido').isLength({ max: 20 }).withMessage('Número de documento inválido'),
  body('shippingZoneId').optional().isInt({ min: 1 }).withMessage('Zona de envío inválida'),
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

export const orderIdParamValidation = [
  param('orderId').isInt({ min: 1 }).withMessage('ID de pedido inválido'),
  validate,
]

export const productIdParamValidation = [
  param('productId').isInt({ min: 1 }).withMessage('ID de producto inválido'),
  validate,
]

export const stockAdjustValidation = [
  body('productId').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('type').isIn(['in', 'adjustment']).withMessage('Tipo de movimiento inválido'),
  body('quantity').isInt({ min: -999999, max: 999999 }).withMessage('Cantidad inválida').custom(value => value === 0 ? false : true).withMessage('La cantidad no puede ser cero'),
  body('reason').optional().trim().isLength({ max: 255 }),
  validate,
]

export const posSaleValidation = [
  body('items').isArray({ min: 1 }).withMessage('El pedido debe tener al menos un producto'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad inválida'),
  body('paymentMethod').isIn(['cash', 'card_pos']).withMessage('Método de pago inválido para POS'),
  body('cashReceived').optional().isFloat({ min: 0 }).withMessage('Monto recibido inválido'),
  body('customerDocumentType').optional().isIn(['CC', 'NIT', 'CE', 'PASSPORT']).withMessage('Tipo de documento inválido'),
  body('customerDocumentNumber').optional().trim().isLength({ max: 20 }).withMessage('Número de documento inválido'),
  body('customerName').optional().trim().isLength({ max: 200 }),
  body('customerEmail').optional().isEmail().normalizeEmail(),
  body('customerPhone').optional().trim().isLength({ max: 50 }),
  body('notes').optional().trim(),
  validate,
]

export const cashRegisterOpenValidation = [
  body('openingAmount').isFloat({ min: 0 }).withMessage('Monto de apertura inválido'),
  body('notes').optional().trim(),
  validate,
]

export const cashRegisterCloseValidation = [
  body('closingAmount').isFloat({ min: 0 }).withMessage('Monto de cierre inválido'),
  body('notes').optional().trim(),
  validate,
]

export const dateRangeValidation = [
  query('from').optional().isISO8601().withMessage('Fecha de inicio inválida'),
  query('to').optional().isISO8601().toDate().withMessage('Fecha de fin inválida'),
  validate,
]