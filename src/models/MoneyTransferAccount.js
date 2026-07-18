const mongoose = require('mongoose');

const MoneyTransferAccountSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    totalAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Active', 'Deactive'],
        default: 'Active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('MoneyTransferAccount', MoneyTransferAccountSchema);
