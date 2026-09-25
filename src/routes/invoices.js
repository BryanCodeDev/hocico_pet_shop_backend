import { Router } from 'express'
import * as invoiceController from '../controllers/invoiceController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { orderIdParamValidation } from '../validations/index.js'

const router = Router()

router.use(authenticate, authorize('admin'))

router.get('/:orderId', orderIdParamValidation, invoiceController.getInvoice)
router.post('/:orderId/retry', orderIdParamValidation, invoiceController.retryInvoice)
router.get('/:orderId/download/:docType', orderIdParamValidation, invoiceController.downloadDocument)

export default router
