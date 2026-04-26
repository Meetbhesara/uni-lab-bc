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
        ifscCode: { type: String, trim: true, uppercase: true }
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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EmployeeMaster', EmployeeMasterSchema);
