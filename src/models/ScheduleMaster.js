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
        enum: ['Pending', 'Completed'],
        default: 'Pending'
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

module.exports = mongoose.model('ScheduleMaster', ScheduleMasterSchema);
