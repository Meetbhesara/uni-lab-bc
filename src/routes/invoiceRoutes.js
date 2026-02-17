const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');

router.post('/create-from-quotation', invoiceController.createInvoiceFromQuotation);
router.get('/', invoiceController.getInvoices);
router.get('/:id/tally', invoiceController.generateTallyXML);

module.exports = router;
