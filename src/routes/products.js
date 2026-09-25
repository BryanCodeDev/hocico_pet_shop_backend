import { Router } from 'express'
import * as productController from '../controllers/productController.js'
import * as adminProductController from '../controllers/adminProductController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { productValidation, idParamValidation, slugParamValidation, paginationValidation } from '../validations/index.js'
import multer from 'multer'

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } })

const router = Router()

router.get('/', paginationValidation, productController.getProducts)
router.get('/featured', productController.getFeaturedProducts)
router.get('/on-sale', productController.getOnSaleProducts)
router.get('/new-arrivals', productController.getNewArrivals)
router.get('/search', productController.searchProducts)
router.get('/:slug', slugParamValidation, productController.getProductBySlug)
router.get('/id/:id', idParamValidation, productController.getProductById)
router.get('/:id/related', idParamValidation, productController.getRelatedProducts)

router.use('/admin', authenticate, authorize('admin'))

router.get('/admin/products', adminProductController.adminGetProducts)
router.get('/admin/products/:id', idParamValidation, adminProductController.adminGetProductById)
router.post('/admin/products', productValidation, adminProductController.adminCreateProduct)
router.put('/admin/products/:id', idParamValidation, productValidation, adminProductController.adminUpdateProduct)
router.delete('/admin/products/:id', idParamValidation, adminProductController.adminDeleteProduct)
router.post('/admin/products/:id/duplicate', idParamValidation, adminProductController.adminDuplicateProduct)
router.patch('/admin/products/:id/featured', idParamValidation, adminProductController.adminToggleFeatured)
router.patch('/admin/products/:id/status', idParamValidation, adminProductController.adminToggleStatus)

router.post('/admin/products/:id/images', idParamValidation, upload.array('images', 10), adminProductController.adminUploadImages)
router.delete('/admin/products/:id/images/:imageId', idParamValidation, adminProductController.adminDeleteImage)
router.patch('/admin/products/:id/images/reorder', idParamValidation, adminProductController.adminReorderImages)
router.patch('/admin/products/:id/images/:imageId/main', idParamValidation, adminProductController.adminSetMainImage)

export default router