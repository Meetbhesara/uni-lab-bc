const express = require('express');
const router = express.Router();
const moneyTransferAccountController = require('../controllers/moneyTransferAccountController');
const auth = require('../middlewares/auth');

router.get('/', auth, moneyTransferAccountController.getAccounts);
router.post('/', auth, moneyTransferAccountController.createAccount);
router.delete('/:id', auth, moneyTransferAccountController.deleteAccount);

module.exports = router;
