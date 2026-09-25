import { Router } from 'express'
import * as adminDashboardController from '../controllers/adminDashboardController.js'
import * as adminProductController from '../controllers/adminProductController.js'
import * as adminCategoryController from '../controllers/categoryController.js'
import * as adminOrderController from '../controllers/orderController.js'
import * as adminUserController from '../controllers/userController.js'
import * as adminSettingsController from '../controllers/adminSettingsController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { idParamValidation, paginationValidation } from '../validations/index.js'
import multer from 'multer'

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } })

const router = Router()

router.use(authenticate, authorize('admin'))

router.get('/dashboard/stats', adminDashboardController.getDashboardStats)
router.get('/dashboard/sales-chart', adminDashboardController.getSalesChart)
router.get('/dashboard/orders-chart', adminDashboardController.getOrdersChart)
router.get('/dashboard/top-products', adminDashboardController.getTopProducts)
router.get('/dashboard/low-stock', adminDashboardController.getLowStockProducts)

router.get('/products', adminProductController.adminGetProducts)
router.get('/products/:id', idParamValidation, adminProductController.adminGetProductById)
router.post('/products', adminProductController.adminCreateProduct)
router.put('/products/:id', idParamValidation, adminProductController.adminUpdateProduct)
router.delete('/products/:id', idParamValidation, adminProductController.adminDeleteProduct)
router.post('/products/:id/duplicate', idParamValidation, adminProductController.adminDuplicateProduct)
router.patch('/products/:id/featured', idParamValidation, adminProductController.adminToggleFeatured)
router.patch('/products/:id/status', idParamValidation, adminProductController.adminToggleStatus)
router.post('/products/:id/images', idParamValidation, upload.array('images', 10), adminProductController.adminUploadImages)
router.delete('/products/:id/images/:imageId', idParamValidation, adminProductController.adminDeleteImage)
router.patch('/products/:id/images/reorder', idParamValidation, adminProductController.adminReorderImages)
router.patch('/products/:id/images/:imageId/main', idParamValidation, adminProductController.adminSetMainImage)

router.get('/categories', adminCategoryController.adminGetCategories)
router.post('/categories', upload.single('image'), adminCategoryController.adminCreateCategory)
router.put('/categories/:id', idParamValidation, upload.single('image'), adminCategoryController.adminUpdateCategory)
router.delete('/categories/:id', idParamValidation, adminCategoryController.adminDeleteCategory)
router.patch('/categories/:id/status', idParamValidation, adminCategoryController.adminToggleStatus)

router.get('/orders', paginationValidation, adminOrderController.adminGetOrders)
router.get('/orders/:id', idParamValidation, adminOrderController.adminGetOrderById)
router.patch('/orders/:id/status', idParamValidation, adminOrderController.adminUpdateOrderStatus)
router.get('/orders/:id/history', idParamValidation, adminOrderController.adminGetOrderHistory)

router.get('/users', paginationValidation, adminUserController.getUsers)
router.get('/users/:id', idParamValidation, adminUserController.getUserById)
router.put('/users/:id', idParamValidation, adminUserController.updateUser)
router.patch('/users/:id/status', idParamValidation, adminUserController.toggleUserStatus)
router.patch('/users/:id/role', idParamValidation, adminUserController.changeUserRole)

router.get('/settings', adminSettingsController.getSettings)
router.put('/settings', adminSettingsController.updateSettings)
router.post('/settings/logo', upload.single('logo'), adminSettingsController.uploadLogo)

export default router