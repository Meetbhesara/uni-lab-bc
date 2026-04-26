const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String }, // 'GST' or 'MSME'
    path: { type: String, required: true }
}, { _id: false });

const ClientMasterSchema = new mongoose.Schema({
    clientId: {
        type: String,
        unique: true
    },
    clientName: {
        type: String,
        trim: true,
        required: true
    },
    refNo: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        lowercase: true,
        trim: true
    },
    contactPerson: {
        name: String,
        phone: String
    },
    panCard: {
        type: String,
        trim: true
    },
    clientAddress: {
        type: String,
        trim: true
    },
    gstNo: {
        type: String,
        trim: true
    },
    msmeNo: {
        type: String,
        trim: true
    },
    documents: [DocumentSchema],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('ClientMaster', ClientMasterSchema);
