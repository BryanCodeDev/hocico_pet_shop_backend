import { Router } from 'express'
import * as cartController from '../controllers/cartController.js'
import { authenticate, optionalAuth } from '../middleware/auth.js'
import { cartValidation, productIdParamValidation } from '../validations/index.js'

const router = Router()

// optionalAuth: el carrito debe funcionar para invitados (cookie cart_session)
// y, si hay sesión iniciada, quedar asociado al user_id.
router.use(optionalAuth)

router.get('/', cartController.getCart)
router.post('/', cartValidation, cartController.addToCart)
router.put('/:productId', productIdParamValidation, cartController.updateCartItem)
router.delete('/:productId', productIdParamValidation, cartController.removeFromCart)
router.delete('/', cartController.clearCart)
router.post('/sync', authenticate, cartController.syncCart)

export default router