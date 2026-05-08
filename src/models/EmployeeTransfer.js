const mongoose = require('mongoose');

const EmployeeTransferSchema = new mongoose.Schema({
    giver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster',
        required: true
    },
    taker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    notes: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EmployeeTransfer', EmployeeTransferSchema);
