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
    sizes: [{
        size: { type: String },
        purchasePrice: { type: Number },
        stock: { type: Number, default: 0 }
    }],
    createdAt: { type: Date, default: Date.now }
});

// ── Indexes (fixes p95=3.2s under load) ───────────────────────────────
// 1. Category filter (product page groups by category)
ProductSchema.index({ category: 1 });
// 2. Search by name or alternativeNames (used in ?search= query)
ProductSchema.index({ name: 'text', alternativeNames: 'text', description: 'text' });
// 3. Newest products first
ProductSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', ProductSchema);
