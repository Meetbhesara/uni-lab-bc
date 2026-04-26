const jwt = require('jsonwebtoken');
const EmployeeMaster = require('../models/EmployeeMaster');
const { sendWhatsapp } = require('../utils/whatsappService');

// In-memory OTP store (phone -> { otp, expires })
// For production, store in DB or Redis
const otpStore = new Map();

// POST /api/employee-auth/send-otp
const sendEmployeeOtp = async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, msg: 'Phone number is required' });

    try {
        const employee = await EmployeeMaster.findOne({ phone: phone.toString().trim() });
        if (!employee) {
            return res.status(401).json({ success: false, msg: 'Unauthorized. No employee found with this phone number.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
        const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
        otpStore.set(phone.toString().trim(), { otp, expires, employeeId: employee._id });

        const msg = `🏗️ *Unique Engineering*\n\nYour Employee Login OTP: *${otp}*\n\nValid for 10 minutes. Do not share this code.`;
        await sendWhatsapp(phone.toString().trim(), msg);

        console.log(`[EmployeeAuth] OTP ${otp} sent to ${phone} for employee ${employee.name}`);
        res.json({ success: true, msg: `OTP sent to WhatsApp number ending in ...${phone.toString().slice(-4)}` });
    } catch (err) {
        console.error('[EmployeeAuth] sendEmployeeOtp error:', err);
        res.status(500).json({ success: false, msg: 'Server error sending OTP' });
    }
};

// POST /api/employee-auth/verify-otp
const verifyEmployeeOtp = async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, msg: 'Phone and OTP are required' });

    try {
        const record = otpStore.get(phone.toString().trim());
        if (!record) return res.status(400).json({ success: false, msg: 'No OTP found. Please request a new one.' });
        if (Date.now() > record.expires) {
            otpStore.delete(phone.toString().trim());
            return res.status(400).json({ success: false, msg: 'OTP has expired. Please request a new one.' });
        }
        if (record.otp !== otp.toString().trim()) {
            return res.status(400).json({ success: false, msg: 'Invalid OTP. Please try again.' });
        }

        // OTP is valid — clear it and issue JWT
        otpStore.delete(phone.toString().trim());

        const employee = await EmployeeMaster.findById(record.employeeId);
        if (!employee) return res.status(404).json({ success: false, msg: 'Employee record not found' });

        const payload = { employeeId: employee._id, type: 'employee' };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

        res.json({
            success: true,
            token,
            employee: {
                _id: employee._id,
                name: employee.name,
                email: employee.email,
                phone: employee.phone,
                photo: employee.photo,
                addressLine1: employee.addressLine1,
                addressLine2: employee.addressLine2,
                emergencyContact: employee.emergencyContact,
                aadharCard: employee.aadharCard,
                panCard: employee.panCard,
                voterId: employee.voterId,
                drivingLicense: employee.drivingLicense,
            }
        });
    } catch (err) {
        console.error('[EmployeeAuth] verifyEmployeeOtp error:', err);
        res.status(500).json({ success: false, msg: 'Server error verifying OTP' });
    }
};

// GET /api/employee-auth/profile  (protected — requires employee JWT)
const getEmployeeProfile = async (req, res) => {
    try {
        const employee = await EmployeeMaster.findById(req.employeeId);
        if (!employee) return res.status(404).json({ success: false, msg: 'Employee not found' });
        res.json({ success: true, data: employee });
    } catch (err) {
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};

module.exports = { sendEmployeeOtp, verifyEmployeeOtp, getEmployeeProfile };
