const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String }, // can be optional, map to contactPersonName
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password: { type: String }, // optional for guest users
    companyName: { type: String },
    contactPersonName: { type: String },
    gstNumber: { type: String },
    isAdmin: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    twoFactorSecret: { type: String },
    isTwoFactorEnabled: { type: Boolean, default: false },
    backupCodes: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
