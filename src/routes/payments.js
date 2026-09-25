import { Router } from 'express'
import * as paymentController from '../controllers/paymentController.js'
import { authenticate } from '../middleware/auth.js'
import { idParamValidation } from '../validations/index.js'

const router = Router()

router.post('/create-payment', authenticate, paymentController.createPayment)
router.post(
  '/create-preference',
  authenticate,
  paymentController.createPayment
)
router.post('/webhook', paymentController.webhook)
router.get('/status/:id', authenticate, paymentController.getPaymentStatus)

export default router
