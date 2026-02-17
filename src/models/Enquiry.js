const mongoose = require('mongoose');

const EnquirySchema = new mongoose.Schema({
    Name: { type: String, required: true }, // Using 'Name' capitalized based on controller usage
    email: { type: String },
    phone: { type: String },
    message: { type: String },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 }
    }],
    type: { type: String, default: 'enquiry' },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Enquiry', EnquirySchema);
