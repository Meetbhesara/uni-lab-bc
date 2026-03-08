const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    details: { type: Map, of: String }, // Assuming key-value pairs
    sellingPriceStart: { type: Number },
    sellingPriceEnd: { type: Number },
    purchasePrice: { type: Number }, // Keep for backward compatibility
    dealerPrice: { type: Number },
    vendor: { type: String }, // Keep for backward compatibility
    vendors: [{
        name: { type: String },
        price: { type: Number }
    }],
    alternativeNames: [String],
    images: [String], // Array of URLs
    pdf: { type: String }, // PDF URL
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);
