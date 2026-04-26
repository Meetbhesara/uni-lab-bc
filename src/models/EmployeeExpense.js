const mongoose = require('mongoose');

const EmployeeExpenseSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployeeMaster',
        required: true
    },
    date: {
        type: Date,
        default: Date.now,
        required: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SiteMaster',
        required: false
    },
    siteIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SiteMaster'
    }],
    attendance: {
        type: String,
        enum: ['Present', 'Absent', 'Half Day'],
        default: 'Present'
    },
    expenses: {
        breakfast: { type: Number, default: 0 },
        lunch: { type: Number, default: 0 },
        dinner: { type: Number, default: 0 },
        petrol: { type: Number, default: 0 },
        other: { type: Number, default: 0 }
    },
    otherExpensesList: [{
        expenseName: { type: String, required: true },
        amount: { type: Number, required: true }
    }],
    creditDebit: {
        givenTo: [{
            employeeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeMaster' },
            amount: { type: Number, required: true }
        }],
        receivedFrom: [{
            employeeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeMaster' },
            amount: { type: Number, required: true }
        }]
    },
    notes: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EmployeeExpense', EmployeeExpenseSchema);
