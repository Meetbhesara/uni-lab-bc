const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const auth = require('../middlewares/auth');

const authOptional = require('../middlewares/authOptional');

router.get('/', auth, cartController.getCart); // Authenticated Only
router.get('/:sessionId', authOptional, cartController.getCart); // Guest (with session ID)

router.post('/', authOptional, cartController.addToCart); // Both (userId or sessionId in body)

module.exports = router;
