const express = require('express');
const router = express.Router();
const employeeTransferController = require('../controllers/employeeTransferController');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');

router.post('/', auth, checkPermission('employeeExpense_transfer_create', 'write'), employeeTransferController.createTransfer);
router.post('/bulk', auth, checkPermission('employeeExpense_transfer_create', 'write'), employeeTransferController.bulkCreateTransfers);
router.get('/', auth, checkPermission('employeeExpense_transfer_view', 'read'), employeeTransferController.getTransfers);
router.put('/:id', auth, checkPermission('employeeExpense_transfer_view', 'write'), employeeTransferController.updateTransfer);
router.delete('/:id', auth, checkPermission('employeeExpense_transfer_view', 'write'), employeeTransferController.deleteTransfer);

module.exports = router;
