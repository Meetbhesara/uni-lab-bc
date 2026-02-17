const Cart = require('../models/Cart');

const getCart = async (req, res) => {
    try {
        const userId = req.user.id; // Assuming auth middleware
        let cart = await Cart.findOne({ userId });
        if (!cart) {
            return res.json({ products: [] });
        }
        await cart.populate('products.productId');
        res.json(cart);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const addToCart = async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const userId = req.user.id;

        let cart = await Cart.findOne({ userId });
        if (cart) {
            // Check if product exists
            let itemIndex = cart.products.findIndex(p => p.productId == productId);
            if (itemIndex > -1) {
                cart.products[itemIndex].quantity = quantity; // Update qty
            } else {
                cart.products.push({ productId, quantity });
            }
            cart = await cart.save();
            return res.status(201).json(cart);
        } else {
            // New cart
            const newCart = await Cart.create({
                userId,
                products: [{ productId, quantity }]
            });
            return res.status(201).json(newCart);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getCart, addToCart };
