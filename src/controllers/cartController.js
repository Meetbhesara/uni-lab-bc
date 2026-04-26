const Cart = require('../models/Cart');

const getCart = async (req, res) => {
    try {
        const { sessionId } = req.params;

        // Prioritize sessionId from URL — frontend always fetches by sessionId.
        // This must match addToCart which also stores by sessionId first.
        let query = {};
        if (sessionId) {
            query.sessionId = sessionId;
        } else if (req.user) {
            query.userId = req.user.id;
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

        // Always use sessionId when provided — this keeps cart consistent with
        // what the frontend fetches (fetchCart uses sessionId, never userId).
        // Admin accounts also use sessionId-based carts on the frontend.
        let query = {};
        if (sessionId) {
            query.sessionId = sessionId;
        } else if (req.user) {
            query.userId = req.user.id;
        } else {
            return res.status(400).json({ msg: "Session ID or User ID required" });
        }

        let cart = await Cart.findOne(query);

        if (cart) {
            const itemIndex = cart.products.findIndex(p => p.productId.toString() === productId.toString());
            if (itemIndex > -1) {
                cart.products[itemIndex].quantity = quantity;
            } else {
                cart.products.push({ productId, quantity });
            }
            cart = await cart.save();
            await cart.populate('products.productId');
            return res.status(201).json(cart);
        } else {
            const newCart = await Cart.create({
                sessionId: sessionId || undefined,
                userId: !sessionId && req.user ? req.user.id : undefined,
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

// DELETE /cart/item/:productId?sessionId=xxx
const removeFromCart = async (req, res) => {
    try {
        const { productId } = req.params;
        const { sessionId } = req.query;

        let query = {};
        if (sessionId) {
            query.sessionId = sessionId;
        } else if (req.user) {
            query.userId = req.user.id;
        } else {
            return res.status(400).json({ msg: "Session ID or User ID required" });
        }

        const cart = await Cart.findOne(query);
        if (!cart) return res.status(404).json({ msg: "Cart not found" });

        const before = cart.products.length;
        cart.products = cart.products.filter(
            p => p.productId.toString() !== productId.toString()
        );

        if (cart.products.length === before) {
            return res.status(404).json({ msg: "Product not found in cart" });
        }

        await cart.save();
        await cart.populate('products.productId');
        return res.json(cart);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const clearCart = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
        const { sessionId } = req.params;

        const deleteConditions = [];
        if (userId) deleteConditions.push({ userId });
        if (sessionId) deleteConditions.push({ sessionId });

        if (deleteConditions.length === 0) {
            return res.status(400).json({ msg: "User ID or Session ID required" });
        }

        await Cart.deleteMany({ $or: deleteConditions });
        res.json({ msg: "Cart cleared" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { getCart, addToCart, removeFromCart, clearCart };
