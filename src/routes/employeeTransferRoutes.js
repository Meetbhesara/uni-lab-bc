const express = require('express');
const router = express.Router();
const employeeTransferController = require('../controllers/employeeTransferController');

router.post('/', employeeTransferController.createTransfer);
router.post('/bulk', employeeTransferController.bulkCreateTransfers);
router.get('/', employeeTransferController.getTransfers);
router.put('/:id', employeeTransferController.updateTransfer);
router.delete('/:id', employeeTransferController.deleteTransfer);

module.exports = router;
