const mongoose = require('mongoose');

const QuotationItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true }, // Unit Price (Manual)
    gst: { type: Number, required: true },   // GST % (Manual)
    amount: { type: Number } // Calculated (Price * Qty)
}, { _id: false });

const QuotationSchema = new mongoose.Schema({
    enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    items: [QuotationItemSchema],
    subTotal: { type: Number },
    packaging: { type: Number, default: 0 }, // New: Packaging Charges
    packagingGst: { type: Number, default: 0 }, // New: GST on Packaging
    gstTotal: { type: Number },
    grandTotal: { type: Number },
    status: { type: String, default: 'Pending', enum: ['Pending', 'Pass', 'Reject', 'Sent', 'Done'] },
    followUps: [{
        date: { type: Date, required: true },
        note: { type: String, required: true },
        isCompleted: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    }],
    pdfPath: { type: String },
    htmlContent: { type: String }, // Keeping for backward comp or generation
    nextFollowUp: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// Calculate totals before saving
QuotationSchema.pre('save', function (next) {
    let sub = 0;
    let gst = 0;

    if (this.items && this.items.length > 0) {
        this.items.forEach(item => {
            const lineAmount = item.price * item.quantity;
            item.amount = lineAmount; // Update item amount
            sub += lineAmount;

            // Assuming item.gst is a percentage (e.g., 18 for 18%)
            const itemGst = (lineAmount * item.gst) / 100;
            gst += itemGst;
        });
    }

    const packaging = this.packaging || 0;
    // Assuming 18% GST on packaging if not provided explicitly, or we calculate it here
    const packagingGst = packaging * 0.18;
    this.packagingGst = packagingGst;

    this.subTotal = sub;
    this.gstTotal = gst + packagingGst; // Total GST includes product GST + packaging GST
    this.grandTotal = sub + packaging + this.gstTotal;
    next();
});

module.exports = mongoose.model('Quotation', QuotationSchema);
