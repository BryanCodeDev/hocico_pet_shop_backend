import { Router } from 'express'
import * as categoryController from '../controllers/categoryController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { categoryValidation, idParamValidation, slugParamValidation, paginationValidation } from '../validations/index.js'
import multer from 'multer'

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } })

const router = Router()

router.get('/', paginationValidation, categoryController.getCategories)
router.get('/:slug', slugParamValidation, categoryController.getCategoryBySlug)
router.get('/:slug/products', slugParamValidation, categoryController.getCategoryProducts)

router.use('/admin', authenticate, authorize('admin'))

router.get('/admin/categories', categoryController.adminGetCategories)
router.post('/admin/categories', upload.single('image'), categoryValidation, categoryController.adminCreateCategory)
router.put('/admin/categories/:id', idParamValidation, upload.single('image'), categoryValidation, categoryController.adminUpdateCategory)
router.delete('/admin/categories/:id', idParamValidation, categoryController.adminDeleteCategory)
router.patch('/admin/categories/:id/status', idParamValidation, categoryController.adminToggleStatus)

export default router