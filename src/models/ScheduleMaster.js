const mongoose = require('mongoose');

const ScheduleMasterSchema = new mongoose.Schema({
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientMaster',
        required: true
    },
    site: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SiteMaster',
        required: true
    },
    scheduleDate: {
        type: Date,
        required: true
    },
    workForAppley: {
        type: String,
        trim: true
    },
    contactPerson: {
        type: String,
        trim: true
    },
    operativeNames: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster'
    }],
    operative: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster'
    },
    helpers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster'
    }],
    ledger: {
        type: String,
        trim: true
    },
    amount: {
        type: Number,
        default: 0
    },
    notes: {
        type: String,
        trim: true
    },
    dayStatus: {
        type: String,
        enum: ['Scheduled', 'Completed', 'Rejected', 'Paused'],
        default: 'Scheduled'
    },
    rejectReason: {
        type: String,
        trim: true,
        default: null
    },
    vehicle: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VehicleMaster'
    },
    instruments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InstrumentMaster'
    }],
    scheduleType: {
        type: String,
        enum: ['VISIT', 'MONTH', 'TOPOGRAPHY SURVEY', 'POINT MARKING', ''],
        default: 'VISIT'
    },
    quantity: {
        type: Number,
        default: 0
    },
    monthGroupId: {
        type: Number
    },
    endDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['Active', 'Deactive', 'active', 'deactive'],
        default: 'Active',
        set: function(val) {
            if (!val) return val;
            const lower = val.toLowerCase();
            if (lower === 'active') return 'Active';
            if (lower === 'deactive') return 'Deactive';
            return val;
        }
    },
    invoiceStatus: {
        type: String,
        enum: ['Pending', 'Completed', 'Proforma', 'Final', 'Closed'],
        default: 'Pending'
    },
    invoiceDetails: {
        type: mongoose.Schema.Types.Mixed
    },
    // Tracks which Proforma Invoice document owns this entry (prevents double-invoicing)
    proformaInvoiceId: {
        type: String,
        default: null
    },
    proformaInvoicePdf: {
        type: String,
        default: null
    },
    // Tracks which Final Invoice document owns this entry
    finalInvoiceId: {
        type: String,
        default: null
    },
    finalInvoicePdf: {
        type: String,
        default: null
    },
    // Timestamp when the entry was locked into an invoice (idempotency guard)
    invoiceLockedAt: {
        type: Date,
        default: null
    },
    paymentRemark: {
        type: String,
        default: null
    },
    paymentMode: {
        type: String,
        default: null
    },
    closedDate: {
        type: Date,
        default: null
    },
    draftingWorkFiles: {
        collectedFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }],
        convertedFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }],
        liningDrawFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }],
        esurveyWorkFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }],
        finalCheckingFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }],
        mailFiles: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, originalFileId: String, status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' } }]
    }
}, { timestamps: true });

// ── Indexes for fast querying (fixes p95=19s under load) ──────────────────────
// 1. Date-based queries: GET /schedule-master?date=xxx (most common query)
ScheduleMasterSchema.index({ scheduleDate: -1 });
// 2. Client+date combo (filter schedules by client for a date range)
ScheduleMasterSchema.index({ client: 1, scheduleDate: -1 });
// 3. Site+date (used in site-specific schedule lookups)
ScheduleMasterSchema.index({ site: 1, scheduleDate: -1 });
// 4. Invoice queries (InvoiceReport page filters by invoiceStatus)
ScheduleMasterSchema.index({ invoiceStatus: 1, scheduleDate: -1 });
// 5. Active vs deactive filtering
ScheduleMasterSchema.index({ status: 1, scheduleDate: -1 });
// 6. Month group schedules (MONTH type schedules)
ScheduleMasterSchema.index({ monthGroupId: 1 });

module.exports = mongoose.model('ScheduleMaster', ScheduleMasterSchema);
