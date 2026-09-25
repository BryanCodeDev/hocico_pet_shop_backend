import { Router } from 'express'
import * as posController from '../controllers/posController.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { posSaleValidation, cashRegisterOpenValidation, cashRegisterCloseValidation, idParamValidation, dateRangeValidation } from '../validations/index.js'

const router = Router()

router.use(authenticate)

// ============================================================
// CASH REGISTER (Caja)
// ============================================================

router.post('/cash-register/open', authorize('admin', 'cashier'), cashRegisterOpenValidation, posController.openCashRegister)
router.get('/cash-register/current', authorize('admin', 'cashier'), posController.getCurrentCashRegister)
router.post('/cash-register/close', authorize('admin', 'cashier'), cashRegisterCloseValidation, posController.closeCashRegister)
router.get('/cash-register/history', authorize('admin', 'cashier'), dateRangeValidation, posController.getCashRegisterHistory)
router.get('/cash-register/admin/history', authorize('admin'), dateRangeValidation, posController.getAllCashRegisters)
router.get('/cash-register/:id', authorize('admin', 'cashier'), idParamValidation, posController.getCashRegisterById)

// ============================================================
// POS SALES (Ventas en tienda física)
// ============================================================

router.get('/sales', authorize('admin', 'cashier'), dateRangeValidation, posController.getPosOrders)
router.post('/sale', authorize('admin', 'cashier'), posSaleValidation, posController.createPosSale)
router.get('/sale/:id/receipt', authorize('admin', 'cashier'), idParamValidation, posController.getPosOrderReceipt)

// Buscar producto por código de barras
router.get('/products/barcode/:barcode', authorize('admin', 'cashier'), posController.getProductByBarcode)

// Buscar productos para POS (con stock disponible)
router.get('/products/search', authorize('admin', 'cashier'), posController.searchProductsForPos)

// ============================================================
// REPORTES POS
// ============================================================

router.get('/reports/daily', authorize('admin', 'cashier'), posController.getDailyReport)
router.get('/reports/admin/daily', authorize('admin'), posController.getAdminDailyReport)
router.get('/reports/admin/by-channel', authorize('admin'), dateRangeValidation, posController.getSalesByChannel)
router.get('/reports/admin/by-payment-method', authorize('admin'), dateRangeValidation, posController.getSalesByPaymentMethod)

// Reportes combinados (admin) y reporte de cajas (admin/cashier)
router.get('/reports/summary', authorize('admin'), dateRangeValidation, posController.getPosReportsSummary)
router.get('/reports/cash-registers', authorize('admin', 'cashier'), dateRangeValidation, posController.getCashRegistersReport)

export default router
