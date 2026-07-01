const mongoose = require('mongoose');

const EmployeeMasterSchema = new mongoose.Schema({
    empId: {
        type: String,
        unique: true
    },
    name: {
        type: String,
        trim: true,
        required: true
    },
    salary: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        default: 0
    },
    designation: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true,
        required: true
    },
    addressLine1: {
        street: String,
        city: String,
        pincode: String
    },
    addressLine2: {
        street: String,
        city: String,
        pincode: String
    },
    emergencyContact: {
        name: String,
        phone: String
    },
    bankDetails: {
        bankName: { type: String, trim: true },
        accountName: { type: String, trim: true },
        accountNumber: { type: String, trim: true },
        ifscCode: { type: String, trim: true, uppercase: true },
        documents: [
            {
                name: String,
                url: String,
                path: String
            }
        ]
    },
    status: {
        type: String,
        enum: ['Active', 'Deactive'],
        default: 'Active'
    },
    foodAllowance: {
        type: String,
        enum: ['Food', 'Without Food'],
        default: 'Food'
    },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Cheque', 'UPI'],
        default: 'Cash'
    },
    paymentStatus: {
        type: String,
        enum: ['Pending', 'Done'],
        default: 'Pending'
    },
    photo: {
        name: String,
        url: String,
        path: String
    },
    aadharCard: {
        name: String,
        url: String,
        path: String
    },
    panCard: {
        name: String,
        url: String,
        path: String
    },
    voterId: {
        name: String,
        url: String,
        path: String
    },
    drivingLicense: {
        name: String,
        url: String,
        path: String
    },
    monthlyPayments: [
        {
            month: { type: String, required: true },
            paymentMode: { type: String, enum: ['Cash', 'Cheque', 'UPI'], default: 'Cash' },
            paymentStatus: { type: String, enum: ['Pending', 'Done'], default: 'Pending' },
            presentDays: { type: Number, default: null },
            absentDays: { type: Number, default: null },
            upad: { type: Number, default: 0 }
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EmployeeMaster', EmployeeMasterSchema);
