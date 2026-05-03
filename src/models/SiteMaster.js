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
    ledger: {
        type: String,
        trim: true
    },
    amount: {
        type: Number,
        default: 0
    },
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
    documents: [{
        name: String,
        url: String,
        path: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SiteMaster', SiteMasterSchema);
