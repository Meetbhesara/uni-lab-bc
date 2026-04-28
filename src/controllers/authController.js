const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendWhatsapp } = require('../utils/whatsappService');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const register = async (req, res) => {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ msg: 'Please enter all fields' });
    }

    if (password.length < 8) {
        return res.status(400).json({ msg: 'Password must be at least 8 characters long' });
    }

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        user = new User({
            name,
            email,
            phone,
            password
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        const payload = {
            id: user.id,
            isAdmin: user.isAdmin
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '1h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ msg: 'Please enter all fields' });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const payload = {
            id: user.id,
            isAdmin: user.isAdmin
        };
        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '1h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const phoneLogin = async (req, res) => {
    const { phone, email } = req.body;

    if (!phone) {
        return res.status(400).json({ msg: 'Please enter phone number' });
    }

    try {
        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const payload = {
            id: user.id,
            isAdmin: user.isAdmin
        };
        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '365d' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, companyName: user.companyName, contactPersonName: user.contactPersonName, gstNumber: user.gstNumber } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const phoneRegister = async (req, res) => {
    const { phone, email, name, companyName, contactPersonName, gstNumber } = req.body;

    if (!phone) {
        return res.status(400).json({ msg: 'Please enter phone number' });
    }

    try {
        let user = await User.findOne({ phone });
        if (user) {
            return res.status(400).json({ msg: 'User with this phone number already exists' });
        }

        // --- NEW: Restrict Admin and Existing Emails ---
        if (email) {
            const existingEmailUser = await User.findOne({ email: email.toLowerCase() });
            if (existingEmailUser) {
                if (existingEmailUser.isAdmin) {
                    return res.status(400).json({ msg: 'Admin emails cannot be used for client accounts' });
                }
                return res.status(400).json({ msg: 'This email is already associated with another phone number' });
            }
        }

        user = new User({
            phone,
            email: email ? email.toLowerCase() : `${phone}@noemail.com`,
            name: name || contactPersonName || companyName || 'Client',
            companyName,
            contactPersonName,
            gstNumber
        });

        await user.save();

        const payload = {
            id: user.id,
            isAdmin: user.isAdmin
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '365d' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, companyName: user.companyName, contactPersonName: user.contactPersonName, gstNumber: user.gstNumber } });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getUserByPhone = async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone });
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const sendOtp = async (req, res) => {
    const { phone, email } = req.body;
    if (!phone && !email) return res.status(400).json({ msg: 'Please enter phone number or email address' });

    try {
        let user;
        if (phone) {
            user = await User.findOne({ phone: phone.toString() });
        } else if (email) {
            user = await User.findOne({ email: email.toLowerCase() });
        }

        if (!user) return res.status(404).json({ msg: 'User not found. Please register.' });

        const targetPhone = user.phone;
        if (!targetPhone) return res.status(400).json({ msg: 'No phone number associated with this account.' });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        const msg = `Your Unique Lab Instrument verification OTP is: *${otp}*\nValid for 10 minutes.`;
        await sendWhatsapp(targetPhone, msg);

        res.json({ msg: `OTP sent successfully to your WhatsApp ending in ${targetPhone.slice(-4)}` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const verifyOtp = async (req, res) => {
    const { phone, email, otp } = req.body;
    if ((!phone && !email) || !otp) return res.status(400).json({ msg: 'Please enter phone/email and OTP' });

    try {
        let user;
        if (phone) {
            user = await User.findOne({ phone: phone.toString() });
        } else if (email) {
            user = await User.findOne({ email: email.toLowerCase() });
        }

        if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ msg: 'Invalid or expired OTP' });
        }

        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const payload = { id: user.id, isAdmin: user.isAdmin };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '365d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, companyName: user.companyName, contactPersonName: user.contactPersonName, gstNumber: user.gstNumber } });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const sendAdminOtp = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'ADMIN_AUTH_ERROR: Missing email address' });

    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ msg: 'Admin account not found for this email' });
        if (!user.isAdmin) return res.status(401).json({ msg: 'Access Denied: This account is not an administrator' });

        // If MFA is enabled, we tell the frontend so it can offer that option
        const is2FA = user.isTwoFactorEnabled;

        const targetPhone = user.phone;
        if (!targetPhone) return res.status(400).json({ msg: 'No phone number associated with this admin account.' });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        const msg = `Your Unique Engineering *Admin Login OTP* is: *${otp}*\nValid for 10 minutes. Do not share this code.`;
        await sendWhatsapp(targetPhone, msg);

        res.json({ 
            msg: `OTP sent to WhatsApp linked to ${user.phone}`,
            is2FAEnabled: user.isTwoFactorEnabled 
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const verifyAdminOtp = async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ msg: 'ADMIN_AUTH_ERROR: Missing email or OTP code' });

    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.isAdmin || user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ msg: 'Invalid or expired Admin OTP. Please try again.' });
        }

        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const payload = { id: user.id, isAdmin: user.isAdmin };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '1h' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin } });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const createAdmin = async (req, res) => {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
        return res.status(400).json({ msg: 'Please enter all fields' });
    }

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ msg: 'User already exists' });
        }

        user = new User({
            name,
            email,
            phone,
            isAdmin: true
        });


        await user.save();

        res.json({ msg: 'Admin created successfully', user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin } });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const setup2FA = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.isAdmin) return res.status(404).json({ msg: 'Admin not found' });

        const secret = speakeasy.generateSecret({ name: `UniqueEngineeringAdmin:${user.email}` });
        user.twoFactorSecret = secret.base32;
        await user.save();

        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ secret: secret.base32, qrCode: qrCodeUrl });
    } catch (err) {
        res.status(500).json({ msg: 'Error setting up 2FA' });
    }
};

const verifyAndEnable2FA = async (req, res) => {
    const { email, token } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.twoFactorSecret) return res.status(404).json({ msg: '2FA not initialized' });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: token
        });

        if (verified) {
            user.isTwoFactorEnabled = true;
            await user.save();
            res.json({ msg: '2FA enabled successfully' });
        } else {
            res.status(400).json({ msg: 'Invalid TOTP token' });
        }
    } catch (err) {
        res.status(500).json({ msg: 'Error verifying 2FA' });
    }
};

const loginWith2FA = async (req, res) => {
    const { email, token } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.isTwoFactorEnabled) return res.status(401).json({ msg: '2FA not enabled' });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: token
        });

        if (verified) {
            const payload = { id: user.id, isAdmin: user.isAdmin };
            jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
                if (err) throw err;
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin } });
            });
        } else {
            res.status(400).json({ msg: 'Invalid TOTP token' });
        }
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
};

module.exports = { register, login, phoneLogin, phoneRegister, getUserByPhone, sendOtp, verifyOtp, sendAdminOtp, verifyAdminOtp, createAdmin, setup2FA, verifyAndEnable2FA, loginWith2FA };
