const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    gst: { type: Number, required: true },
    amount: { type: Number }
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation' },
    enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    invoiceDate: { type: Date, default: Date.now },
    dueDate: { type: Date },

    items: [InvoiceItemSchema],

    subTotal: { type: Number },
    packaging: { type: Number, default: 0 },
    packagingGst: { type: Number, default: 0 },
    gstTotal: { type: Number },
    grandTotal: { type: Number },

    status: { type: String, default: 'Unpaid', enum: ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled'] },
    paymentMode: { type: String }, // Cash, Cheque, UPI, Bank Transfer

    // Tally Specific
    tallyExported: { type: Boolean, default: false },
    tallyVoucherNumber: { type: String },

    createdAt: { type: Date, default: Date.now }
});

// Calculate totals before saving (Mirroring Quotation logic)
InvoiceSchema.pre('save', function (next) {
    let sub = 0;
    let gst = 0;

    if (this.items && this.items.length > 0) {
        this.items.forEach(item => {
            const lineAmount = item.price * item.quantity;
            item.amount = lineAmount;
            sub += lineAmount;

            const itemGst = (lineAmount * item.gst) / 100;
            gst += itemGst;
        });
    }

    const packaging = this.packaging || 0;
    const packagingGst = packaging * 0.18; // 18% GST on packaging
    this.packagingGst = packagingGst;

    this.subTotal = sub;
    this.gstTotal = gst + packagingGst;
    this.grandTotal = sub + packaging + this.gstTotal;
    next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
