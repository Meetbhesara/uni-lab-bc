const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    details: { type: Map, of: String }, // Assuming key-value pairs
    sellingPriceStart: { type: Number },
    sellingPriceEnd: { type: Number },
    purchasePrice: { type: Number },
    dealerPrice: { type: Number },
    vendor: { type: String },
    alternativeNames: [String],
    images: [String], // Array of URLs
    pdf: { type: String }, // PDF URL
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);
