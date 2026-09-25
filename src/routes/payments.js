import { Router } from 'express'
import * as paymentController from '../controllers/paymentController.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = Router()

router.post('/create-preference', authenticate, paymentController.createPreference)
router.post('/webhook', paymentController.webhook)
router.get('/status/:id', authenticate, paymentController.getPaymentStatus)

export default router