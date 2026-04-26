const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const auth = require('../middlewares/auth');
const authOptional = require('../middlewares/authOptional');

router.get('/', auth, cartController.getCart);
router.get('/:sessionId', authOptional, cartController.getCart);

router.post('/', authOptional, cartController.addToCart);

// Remove single item from cart (frontend calls DELETE /cart/item/:productId?sessionId=xxx)
router.delete('/item/:productId', authOptional, cartController.removeFromCart);

router.delete('/:sessionId', authOptional, cartController.clearCart);
router.delete('/', auth, cartController.clearCart);

module.exports = router;
