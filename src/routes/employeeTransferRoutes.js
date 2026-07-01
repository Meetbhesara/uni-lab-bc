const express = require('express');
const router = express.Router();
const employeeTransferController = require('../controllers/employeeTransferController');
const auth = require('../middlewares/auth');

router.post('/', auth, employeeTransferController.createTransfer);
router.post('/bulk', auth, employeeTransferController.bulkCreateTransfers);
router.get('/', employeeTransferController.getTransfers);
router.put('/:id', employeeTransferController.updateTransfer);
router.delete('/:id', employeeTransferController.deleteTransfer);

module.exports = router;
