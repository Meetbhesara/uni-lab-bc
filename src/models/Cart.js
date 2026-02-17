const mongoose = require('mongoose');

const CartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sessionId: { type: String, index: true }, // For guest carts
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true, default: 1 },
        // Add price if you want to freeze it, but usually referenced from Product
    }],
    active: { type: Boolean, default: true },
    modifiedOn: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Cart', CartSchema);
