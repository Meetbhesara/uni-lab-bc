const mongoose = require('mongoose');

const QuotationItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true }, // Unit Price (Manual)
    gst: { type: Number, required: true },   // GST % (Manual)
    amount: { type: Number }, // Calculated (Price * Qty)
    size: { type: String },    // Selected Size variant (optional)
    selectedSizes: [{
        size: { type: String },
        quantity: { type: Number, default: 1 }
    }]
}, { _id: false });

const FollowUpSchema = new mongoose.Schema({
    remark:          { type: String, required: true },
    nextFollowUpDate:{ type: Date, required: true },  // Next follow-up date set by user
    addedBy:         { type: String, default: 'Admin' }, // Name of user who added
    addedAt:         { type: Date, default: Date.now }
});

const QuotationSchema = new mongoose.Schema({
    enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    refNo: { type: String }, // e.g. \"000001-2026\"
    items: [QuotationItemSchema],
    subTotal: { type: Number },
    discount: { type: Number, default: 0 }, // Flat discount amount
    packaging: { type: Number, default: 0 }, // Packaging Charges
    packagingGst: { type: Number, default: 0 }, // GST on Packaging
    gstTotal: { type: Number },
    grandTotal: { type: Number },
    status: { type: String, default: 'Pending', enum: ['Pending', 'Pass', 'Reject', 'Sent', 'Done', 'Processed'] },
    followUps: [FollowUpSchema],
    firstFollowUpDate: { type: Date }, // Auto-set to createdAt + 2 days on creation
    nextFollowUp: { type: Date },      // Tracks current active next follow-up date
    pdfPath: { type: String },
    htmlContent: { type: String },
    // isLatest = true → active/current revision. false → superseded by a newer revision (R1, R2, etc.)
    isLatest: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

// Auto-set firstFollowUpDate = createdAt + 2 days on first creation
QuotationSchema.pre('save', function (next) {
    // Set first follow-up date only once on new document creation
    if (this.isNew && !this.firstFollowUpDate) {
        const followDate = new Date(this.createdAt || new Date());
        followDate.setDate(followDate.getDate() + 2);
        this.firstFollowUpDate = followDate;
        // Also set nextFollowUp to the same initial date if not provided
        if (!this.nextFollowUp) {
            this.nextFollowUp = followDate;
        }
        if (!this.followUps || this.followUps.length === 0) {
            this.followUps.push({
                remark: '-',
                nextFollowUpDate: followDate,
                addedBy: 'System',
                addedAt: new Date()
            });
        }
    }

    // Calculate totals
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
    const discount = this.discount || 0;
    // Assuming 18% GST on packaging if not provided explicitly, or we calculate it here
    const packagingGst = packaging * 0.18;
    this.packagingGst = packagingGst;

    this.subTotal = sub;
    this.gstTotal = gst + packagingGst; // Total GST includes product GST + packaging GST
    this.grandTotal = sub + packaging + this.gstTotal - discount;
    next();
});

module.exports = mongoose.model('Quotation', QuotationSchema);

