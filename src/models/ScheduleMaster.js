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
        enum: ['Scheduled', 'Completed', 'Rejected'],
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
    status: {
        type: String,
        enum: ['Active', 'Deactive'],
        default: 'Active'
    }
}, { timestamps: true });

module.exports = mongoose.model('ScheduleMaster', ScheduleMasterSchema);
