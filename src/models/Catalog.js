const mongoose = require('mongoose');

const CatalogSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    category: {
        type: String,
        trim: true,
        default: 'General'
    },
    pdfUrl: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        default: ''
    },
    fileSize: {
        type: String,
        default: ''
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Catalog', CatalogSchema);
