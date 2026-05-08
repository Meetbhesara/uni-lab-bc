const mongoose = require('mongoose');

const EmployeeLedgerSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster',
        required: true
    },
    date: {
        type: Date,
        default: Date.now,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['Credit', 'Debit'],
        required: true
    },
    category: {
        type: String,
        enum: ['Expense', 'Transfer', 'Salary', 'Advance', 'Adjustment'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false // ID of the EmployeeExpense or EmployeeTransfer
    },
    relatedEmployee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster',
        required: false // In case of transfer
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EmployeeLedger', EmployeeLedgerSchema);
