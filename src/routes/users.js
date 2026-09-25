import { Router } from 'express'
import * as userController from '../controllers/userController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { idParamValidation, paginationValidation } from '../validations/index.js'

const router = Router()

router.get('/', authenticate, paginationValidation, userController.getUsers)
router.get('/:id', authenticate, idParamValidation, userController.getUserById)
router.put('/:id', authenticate, authorize('admin'), idParamValidation, userController.updateUser)
router.patch('/:id/status', authenticate, authorize('admin'), idParamValidation, userController.toggleUserStatus)
router.patch('/:id/role', authenticate, authorize('admin'), idParamValidation, userController.changeUserRole)

export default router