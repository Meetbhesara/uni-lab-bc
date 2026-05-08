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
    clientSites: [{
        clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientMaster' },
        siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'SiteMaster' }
    }],
    expenses: {
        breakfast: { type: Number, default: 0 },
        lunch: { type: Number, default: 0 },
        dinner: { type: Number, default: 0 },
        petrol: { type: Number, default: 0 }
    },
    otherExpensesList: [{
        expenseName: { type: String, required: true },
        amount: { type: Number, required: true }
    }],
    totalExpense: {
        type: Number,
        required: true,
        default: 0
    },
    remainingBalance: {
        type: Number,
        default: 0
    },
    photos: [{
        name: String,
        url: String,
        path: String
    }],
    dataFiles: [{
        name: String,
        url: String,
        path: String
    }],
    dailyReports: [{
        name: String,
        url: String,
        path: String
    }],
    notes: {
        type: String
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('EmployeeExpense', EmployeeExpenseSchema);
