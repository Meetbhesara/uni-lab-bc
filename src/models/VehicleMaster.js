const mongoose = require('mongoose');

// Sub-schema for owner info (purchase or sell)
const OwnerInfoSchema = new mongoose.Schema({
    ownerName:    { type: String, trim: true },
    purchaseDate: { type: Date },
    sellDate:     { type: Date },
    purchaseRate: { type: Number },
    sellRate:     { type: Number },
    paymentMode:  { type: String, trim: true }, // Cash, UPI, Bank Transfer, Cheque, DD
    mobileNumbers: [{ type: String, trim: true }],
    emails:        [{ type: String, trim: true, lowercase: true }],
    aadharNumber:  { type: String, trim: true },
    panNumber:     { type: String, trim: true, uppercase: true },
}, { _id: false });

const VehicleMasterSchema = new mongoose.Schema({
    vehicleNumber: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        required: true
    },
    vehicleName: {
        type: String,
        trim: true
    },
    insuranceDate: { type: Date },
    pucDate:       { type: Date },
    serviceDate:   { type: Date },
    rcBook: {
        name: String,
        url: String,
        path: String
    },
    insurancePhoto: {
        name: String,
        url: String,
        path: String
    },
    pucPhoto: {
        name: String,
        url: String,
        path: String
    },
    logInName: { type: String },

    // ── Purchase Owner Details ──────────────────────────────────────────────
    purchaseInfo:    { type: OwnerInfoSchema, default: () => ({}) },
    purchaseAadharDoc: {
        name: String,
        url:  String,
        path: String
    },
    purchasePanDoc: {
        name: String,
        url:  String,
        path: String
    },

    // ── Sell-Out Details ────────────────────────────────────────────────────
    isSold:      { type: Boolean, default: false },
    sellInfo:    { type: OwnerInfoSchema, default: () => ({}) },
    sellAadharDoc: {
        name: String,
        url:  String,
        path: String
    },
    sellPanDoc: {
        name: String,
        url:  String,
        path: String
    },

    // ── Photos & Misc docs ──────────────────────────────────────────────────
    vehiclePhotos: [{
        name: String,
        url:  String,
        path: String
    }],
    documents: [{
        name: String,
        url:  String,
        type: String,
        path: String
    }],

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VehicleMaster', VehicleMasterSchema);
