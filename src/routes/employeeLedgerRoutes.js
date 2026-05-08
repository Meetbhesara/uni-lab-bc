const express = require('express');
const router = express.Router();
const employeeLedgerController = require('../controllers/employeeLedgerController');

router.get('/:employeeId', employeeLedgerController.getEmployeeLedger);
router.get('/report/general', employeeLedgerController.getGeneralReport);

module.exports = router;
