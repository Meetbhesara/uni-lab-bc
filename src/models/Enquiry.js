const mongoose = require('mongoose');

const FollowUpSchema = new mongoose.Schema({
    remark:          { type: String, required: true },
    nextFollowUpDate:{ type: Date, required: true },
    addedBy:         { type: String, default: 'Admin' },
    addedAt:         { type: Date, default: Date.now }
});

const EnquirySchema = new mongoose.Schema({
    Name: { type: String, required: true }, // Using 'Name' capitalized based on controller usage
    companyName: { type: String },
    contactPersonName: { type: String },
    gstNumber: { type: String },
    email: { type: String },
    phone: { type: String },
    message: { type: String },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 }
    }],
    type: { type: String, default: 'enquiry' },
    status: { type: String, default: 'Pending', enum: ['Pending', 'Pass', 'Reject', 'Sent', 'Done'] },
    isSeen: { type: Boolean, default: false },
    followUps: [FollowUpSchema],
    firstFollowUpDate: { type: Date },
    nextFollowUp: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// ── Indexes (fixes p95=5.3s under load) ───────────────────────────────
// 1. Admin panel: show newest enquiries first, filter by status
EnquirySchema.index({ status: 1, createdAt: -1 });
// 2. Unread badge count (isSeen=false)
EnquirySchema.index({ isSeen: 1 });
// 3. Date-only sort (general listing)
EnquirySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Enquiry', EnquirySchema);
