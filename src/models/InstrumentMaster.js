const mongoose = require('mongoose');

const InstrumentMasterSchema = new mongoose.Schema({
    model: {
        type: String,
        trim: true
    },
    serialNo: {
        type: String,
        trim: true,
        required: true,
        unique: true
    },
    instrumentName: {
        type: String,
        trim: true,
        required: false
    },
    photo: {
        name: String,
        url: String,
        path: String
    },
    photos: [{
        name: String,
        url: String,
        path: String
    }],
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
