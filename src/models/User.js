const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String }, // can be optional, map to contactPersonName
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true },
    password: { type: String }, // optional for guest users
    companyName: { type: String },
    contactPersonName: { type: String },
    gstNumber: { type: String },
    isAdmin: { type: Boolean, default: false },
    isSuperAdmin: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    twoFactorSecret: { type: String },
    isTwoFactorEnabled: { type: Boolean, default: false },
    backupCodes: [{ type: String }],
    permissions: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.statics.findByEmail = function(email) {
    if (!email) return null;
    const escapedEmail = email.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return this.findOne({ email: { $regex: new RegExp("^" + escapedEmail + "$", "i") } });
};

module.exports = mongoose.model('User', UserSchema);
