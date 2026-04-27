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
    operativeName: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster'
    },
    helpers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster'
    }],
    notes: {
        type: String,
        trim: true
    },
    dayStatus: {
        type: String,
        enum: ['scheduled', 'complete'],
        default: 'scheduled'
    },
    status: {
        type: String,
        enum: ['active', 'deactive'],
        default: 'active'
    }
}, { timestamps: true });

module.exports = mongoose.model('ScheduleMaster', ScheduleMasterSchema);
