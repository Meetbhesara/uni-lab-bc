const express = require('express');
const router = express.Router();
const { register, login, phoneLogin, phoneRegister, getUserByPhone } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/phone-login', phoneLogin);
router.post('/phone-register', phoneRegister);
router.get('/phone/:phone', getUserByPhone);

module.exports = router;
