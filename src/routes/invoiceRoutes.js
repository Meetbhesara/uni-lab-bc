const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');

router.post('/create-from-quotation', auth, checkPermission('invoiceReport', 'write'), invoiceController.createInvoiceFromQuotation);
router.get('/', auth, checkPermission('invoiceReport', 'read'), invoiceController.getInvoices);
router.get('/:id/tally', auth, checkPermission('invoiceReport', 'read'), invoiceController.generateTallyXML);

module.exports = router;
