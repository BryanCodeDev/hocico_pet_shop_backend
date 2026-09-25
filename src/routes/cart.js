import { Router } from 'express'
import * as cartController from '../controllers/cartController.js'
import { authenticate } from '../middleware/auth.js'
import { cartValidation, idParamValidation } from '../validations/index.js'

const router = Router()

router.get('/', cartController.getCart)
router.post('/', cartValidation, cartController.addToCart)
router.put('/:productId', idParamValidation, cartController.updateCartItem)
router.delete('/:productId', idParamValidation, cartController.removeFromCart)
router.delete('/', cartController.clearCart)
router.post('/sync', authenticate, cartController.syncCart)

export default router