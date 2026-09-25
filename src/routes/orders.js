import { Router } from 'express'
import * as orderController from '../controllers/orderController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { orderValidation, idParamValidation, paginationValidation } from '../validations/index.js'

const router = Router()

router.post('/', orderValidation, orderController.createOrder)
router.get('/my', authenticate, paginationValidation, orderController.getMyOrders)
router.get('/:id', authenticate, idParamValidation, orderController.getOrderByIdPublic)
router.get('/number/:orderNumber', authenticate, orderController.getOrderByNumber)

router.use('/admin', authenticate, authorize('admin'))

router.get('/admin/orders', paginationValidation, orderController.adminGetOrders)
router.get('/admin/orders/:id', idParamValidation, orderController.adminGetOrderById)
router.patch('/admin/orders/:id/status', idParamValidation, orderController.adminUpdateOrderStatus)
router.get('/admin/orders/:id/history', idParamValidation, orderController.adminGetOrderHistory)

export default router