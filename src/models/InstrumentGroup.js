const mongoose = require('mongoose');

const InstrumentGroupSchema = new mongoose.Schema({
    groupId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    instruments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InstrumentMaster'
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('InstrumentGroup', InstrumentGroupSchema);
