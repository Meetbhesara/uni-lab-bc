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
    localImages: [String], // Array of local/NAS relative URLs
    localPdf: { type: String }, // Local/NAS relative URL
    localVideos: [String], // Array of local/NAS relative video paths
    videoLinks: [String], // Array of external video links/URLs (e.g. YouTube)
    stock: { type: Number, default: 0, min: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);
