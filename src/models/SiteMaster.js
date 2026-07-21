const mongoose = require('mongoose');

const SiteMasterSchema = new mongoose.Schema({
    siteId: {
        type: String,
        unique: true
    },
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientMaster'
    },
    siteName: {
        type: String,
        trim: true,
        required: true
    },
    workForAppley: {
        type: String,
        trim: true
    },
    ledgerItems: [{
        ledger: { type: String, trim: true },
        amount: { type: Number, default: 0 }
    }],
    contactPhone: {
        type: String,
        trim: true
    },
    contactPersons: [{
        name: String,
        phone: String
    }],
    siteAddress: {
        type: String,
        trim: true
    },
    siteLocation: {
        type: String,
        trim: true
    },
    stateName: {
        type: String,
        trim: true,
        default: 'Gujarat'
    },
    stateCode: {
        type: String,
        trim: true,
        default: '24'
    },
    documents: [{
        name: String,
        url: String,
        path: String,
        status: { type: String, default: 'Received' },
        uploadedAt: { type: Date, default: Date.now },
        isDraft: { type: Boolean, default: false },
        linkedDocumentId: { type: String },
        approvalDate: { type: Date },
        inMail: { type: Boolean, default: false },
        mailFolderName: { type: String }
    }],
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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ── Indexes (fixes p95=9.7s under load) ───────────────────────────────
// 1. Client lookup: GET /site-master filtered by client (most common)
SiteMasterSchema.index({ client: 1, status: 1 });
// 2. Active sites list (default view shows only Active sites)
SiteMasterSchema.index({ status: 1 });
// 3. Text search on site name
SiteMasterSchema.index({ siteName: 'text' });

module.exports = mongoose.model('SiteMaster', SiteMasterSchema);
