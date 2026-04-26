const mongoose = require('mongoose');

const InstrumentMasterSchema = new mongoose.Schema({
    refNo: {
        type: String,
        trim: true,
        unique: true
    },
    instrumentName: {
        type: String,
        trim: true,
        required: true
    },
    photo: {
        name: String,
        url: String,
        path: String
    },
    notes: {
        type: String,
        trim: true,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('InstrumentMaster', InstrumentMasterSchema);
