import { Router } from 'express'
import * as authController from '../controllers/authController.js'
import { authenticate } from '../middleware/auth.js'
import { registerValidation, loginValidation, updateProfileValidation, changePasswordValidation } from '../validations/index.js'

const router = Router()

router.post('/register', registerValidation, authController.register)
router.post('/login', loginValidation, authController.login)
router.post('/logout', authController.logout)
router.get('/me', authenticate, authController.getMe)
router.put('/profile', authenticate, updateProfileValidation, authController.updateProfile)
router.put('/password', authenticate, changePasswordValidation, authController.changePassword)
router.post('/forgot-password', authController.forgotPassword)
router.post('/reset-password', authController.resetPassword)

export default router