const mongoose = require('mongoose');

const AdminLoginLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    loginAt: { type: Date, default: Date.now },
    dateStr: { type: String, required: true, index: true }, // YYYY-MM-DD
    ipAddress: { type: String }
});

module.exports = mongoose.model('AdminLoginLog', AdminLoginLogSchema);
