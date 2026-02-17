const Cart = require('../models/Cart');

const getCart = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
        const { sessionId } = req.params; // Expect sessionId in params if guest

        let query = {};
        if (userId) {
            query.userId = userId;
        } else if (sessionId) {
            query.sessionId = sessionId;
        } else {
            return res.json({ products: [] });
        }

        let cart = await Cart.findOne(query).populate('products.productId');
        if (!cart) {
            return res.json({ products: [] });
        }
        res.json(cart);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const addToCart = async (req, res) => {
    try {
        const { productId, quantity, sessionId } = req.body;
        const userId = req.user ? req.user.id : null;

        let query = {};
        if (userId) {
            query.userId = userId;
        } else if (sessionId) {
            query.sessionId = sessionId;
        } else {
            return res.status(400).json({ msg: "User ID or Session ID required" });
        }

        let cart = await Cart.findOne(query);

        if (cart) {
            // Check if product exists
            let itemIndex = cart.products.findIndex(p => p.productId == productId);
            if (itemIndex > -1) {
                cart.products[itemIndex].quantity = quantity; // Update qty
            } else {
                cart.products.push({ productId, quantity });
            }
            cart = await cart.save();
            await cart.populate('products.productId'); // Return populated cart
            return res.status(201).json(cart);
        } else {
            // New cart
            const newCart = await Cart.create({
                userId: userId || undefined,
                sessionId: sessionId || undefined,
                products: [{ productId, quantity }]
            });
            await newCart.populate('products.productId');
            return res.status(201).json(newCart);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getCart, addToCart };
