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
        scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduleMaster' },
        clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientMaster' },
        siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'SiteMaster' },
        ledger: { type: String, trim: true },
        files: {
            photos: [{ name: String, url: String, path: String, status: { type: String, default: 'Received' }, uploadedAt: { type: Date, default: Date.now }, isDraft: { type: Boolean, default: false }, linkedDocumentId: { type: String }, approvalDate: { type: Date }, inMail: { type: Boolean, default: false }, mailFolderName: { type: String } }],
            dailyReports: [{ name: String, url: String, path: String, status: { type: String, default: 'Received' }, uploadedAt: { type: Date, default: Date.now }, isDraft: { type: Boolean, default: false }, linkedDocumentId: { type: String }, approvalDate: { type: Date }, inMail: { type: Boolean, default: false }, mailFolderName: { type: String } }],
            data: [{ name: String, url: String, path: String, status: { type: String, default: 'Received' }, uploadedAt: { type: Date, default: Date.now }, isDraft: { type: Boolean, default: false }, linkedDocumentId: { type: String }, approvalDate: { type: Date }, inMail: { type: Boolean, default: false }, mailFolderName: { type: String } }],
            drawing: [{ name: String, url: String, path: String, status: { type: String, default: 'Received' }, uploadedAt: { type: Date, default: Date.now }, isDraft: { type: Boolean, default: false }, linkedDocumentId: { type: String }, approvalDate: { type: Date }, inMail: { type: Boolean, default: false }, mailFolderName: { type: String } }]
        }
    }],
    expenses: {
        breakfast: { type: Number, default: 0 },
        lunch: { type: Number, default: 0 },
        dinner: { type: Number, default: 0 },
        petrol: { type: Number, default: 0 }
    },
    expenseFiles: {
        breakfast: [{ name: String, url: String, path: String }],
        lunch: [{ name: String, url: String, path: String }],
        dinner: [{ name: String, url: String, path: String }],
        petrol: [{ name: String, url: String, path: String }]
    },
    otherExpensesList: [{
        expenseName: { type: String, required: true },
        amount: { type: Number, required: true },
        files: [{ name: String, url: String, path: String }]
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
    attendance: {
        type: String,
        enum: ['Present', 'Absent', 'Half Day'],
        default: 'Present'
    },
    attendanceRemark: {
        type: String
    },
    creditDebit: {
        givenTo: [{
            employeeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeMaster' },
            amount: { type: Number, default: 0 }
        }],
        receivedFrom: [{
            employeeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeMaster' },
            amount: { type: Number, default: 0 }
        }]
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
