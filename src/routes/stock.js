import { Router } from 'express'
import * as stockController from '../controllers/stockController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { stockAdjustValidation, productIdParamValidation } from '../validations/index.js'

const router = Router()

router.use(authenticate, authorize('admin'))

router.post('/adjust', stockAdjustValidation, stockController.adminAdjustStock)
router.get('/:productId/history', productIdParamValidation, stockController.getStockHistory)

export default router
