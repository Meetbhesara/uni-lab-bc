const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SystemSettings = require('../models/SystemSettings');
const AdminLoginLog = require('../models/AdminLoginLog');
const { sendWhatsapp } = require('../utils/whatsappService');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

const recordAdminLogin = async (user, req) => {
    try {
        if (!user || !user.isAdmin) return;
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffset);
        const dateStr = istDate.toISOString().split('T')[0];

        const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '') : '';

        await AdminLoginLog.create({
            userId: user._id || user.id,
            name: user.name || 'Admin',
            email: user.email || '',
            phone: user.phone || '',
            loginAt: now,
            dateStr: dateStr,
            ipAddress: typeof ip === 'string' ? ip.split(',')[0] : ''
        });
    } catch (err) {
        console.error('Failed to record admin login log:', err.message);
    }
};

const checkUserLocation = async (user, body) => {
    if (user && user.isAdmin && !user.isSuperAdmin) {
        const { latitude, longitude } = body;

        let locationsSetting = await SystemSettings.findOne({ key: 'officeLocations' });
        let locations = [];

        if (!locationsSetting) {
            let latSetting = await SystemSettings.findOne({ key: 'officeLatitude' });
            let lonSetting = await SystemSettings.findOne({ key: 'officeLongitude' });
            let radSetting = await SystemSettings.findOne({ key: 'allowedRadius' });

            const defaultLoc = {
                id: 'default-rajkot',
                name: 'Rajkot Head Office',
                latitude: latSetting ? parseFloat(latSetting.value) : 22.302368784634364,
                longitude: lonSetting ? parseFloat(lonSetting.value) : 70.82868261801187,
                radius: radSetting ? parseFloat(radSetting.value) : 200
            };
            locations = [defaultLoc];

            locationsSetting = new SystemSettings({
                key: 'officeLocations',
                value: JSON.stringify(locations)
            });
            await locationsSetting.save();
        } else {
            try {
                locations = JSON.parse(locationsSetting.value);
            } catch (e) {
                locations = [];
            }
        }

        // If no locations are configured in the system, bypass check entirely
        if (!Array.isArray(locations) || locations.length === 0) {
            return;
        }

        // If locations exist, browser coordinates are strictly required!
        if (!latitude || !longitude) {
            throw new Error('Location access is required for administrative login.');
        }

        const userLat = parseFloat(latitude);
        const userLon = parseFloat(longitude);
        let withinAnyLocation = false;
        let matchedLocationName = '';

        for (const loc of locations) {
            const distance = getDistanceInMeters(userLat, userLon, parseFloat(loc.latitude), parseFloat(loc.longitude));
            if (distance <= parseFloat(loc.radius)) {
                withinAnyLocation = true;
                matchedLocationName = loc.name;
                break;
            }
        }

        if (!withinAnyLocation) {
            const locationNames = locations.map(l => l.name).join(', ');
            throw new Error(`Access Denied: You must be within the allowed boundary of one of the authorized locations: ${locationNames}.`);
        }
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -twoFactorSecret -backupCodes');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        if (user.isAdmin) {
            const now = new Date();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istDate = new Date(now.getTime() + istOffset);
            const dateStr = istDate.toISOString().split('T')[0];
            const existingToday = await AdminLoginLog.findOne({ userId: user._id, dateStr });
            if (!existingToday) {
                await recordAdminLogin(user, req);
            }
        }

        res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin, permissions: user.permissions, companyName: user.companyName, contactPersonName: user.contactPersonName, gstNumber: user.gstNumber });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

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

        // --- Location Check ---
        try {
            await checkUserLocation(user, req.body);
        } catch (locErr) {
            return res.status(403).json({ msg: locErr.message });
        }

        const payload = {
            id: user.id,
            isAdmin: user.isAdmin
        };
        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE || '1h' },
            async (err, token) => {
                if (err) throw err;
                if (user.isAdmin) {
                    await recordAdminLogin(user, req);
                }
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
            if (user.isAdmin) {
                return res.status(403).json({ msg: 'Administrative account' });
            }
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

        // --- NEW: Restrict Admins from Client Login ---
        if (user.isAdmin) {
            return res.status(403).json({ msg: 'Administrative account' });
        }

        const targetPhone = user.phone;
        if (!targetPhone) return res.status(400).json({ msg: 'No phone number associated with this account.' });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        const msg = `Your Unique Lab Instrument verification OTP is: *${otp}*\nValid for 10 minutes.`;
        await sendWhatsapp(targetPhone, msg, null, true);

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
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin, permissions: user.permissions, companyName: user.companyName, contactPersonName: user.contactPersonName, gstNumber: user.gstNumber } });
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

        // --- Location Check ---
        try {
            await checkUserLocation(user, req.body);
        } catch (locErr) {
            return res.status(403).json({ msg: locErr.message });
        }

        // If MFA is enabled, we tell the frontend so it can offer that option
        const is2FA = user.isTwoFactorEnabled;

        const targetPhone = user.phone;
        if (!targetPhone) return res.status(400).json({ msg: 'No phone number associated with this admin account.' });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        let whatsappStatus = 'sent';
        try {
            const msg = `Your Unique Engineering *Admin Login OTP* is: *${otp}*\nValid for 10 minutes. Do not share this code.`;
            await sendWhatsapp(targetPhone, msg, null, true);
        } catch (wsErr) {
            console.error('WhatsApp Send Failure:', wsErr.message);
            whatsappStatus = 'failed';
        }

        res.json({ 
            success: true,
            msg: whatsappStatus === 'sent' 
                ? `OTP sent to WhatsApp linked to ${user.phone}`
                : `WhatsApp service is currently offline. You can use Google Authenticator if enabled, or try again later.`,
            is2FAEnabled: user.isTwoFactorEnabled,
            whatsappStatus
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

        // --- Location Check ---
        try {
            await checkUserLocation(user, req.body);
        } catch (locErr) {
            return res.status(403).json({ msg: locErr.message });
        }

        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const payload = { id: user.id, isAdmin: user.isAdmin };
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '1h' }, async (err, token) => {
            if (err) throw err;
            await recordAdminLogin(user, req);
            res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin, permissions: user.permissions } });
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
            // --- Location Check ---
            try {
                await checkUserLocation(user, req.body);
            } catch (locErr) {
                return res.status(403).json({ msg: locErr.message });
            }

            const payload = { id: user.id, isAdmin: user.isAdmin };
            jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }, async (err, token) => {
                if (err) throw err;
                await recordAdminLogin(user, req);
                res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin, permissions: user.permissions } });
            });
        } else {
            res.status(400).json({ msg: 'Invalid TOTP token' });
        }
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
};

// Reset 2FA using Master Recovery Code (Emergency Fallback)
// POST /auth/reset-with-backup  { email, backupCode }
const resetWithBackupCode = async (req, res) => {
    const { email, backupCode } = req.body;

    if (!email || !backupCode) return res.status(400).json({ msg: 'Email and Master Code are required.' });

    try {
        // Fetch Master Code from Database
        let settings = await SystemSettings.findOne({ key: 'masterRecoveryCode' });
        
        // Auto-seed if not exists (first time use)
        if (!settings) {
            settings = new SystemSettings({ key: 'masterRecoveryCode', value: 'Dskanak@1966' });
            await settings.save();
        }

        const MASTER_CODE = settings.value;

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.isAdmin) return res.status(404).json({ msg: 'Admin account not found.' });

        // Verify against DB Master Code
        if (backupCode !== MASTER_CODE) {
            return res.status(400).json({ msg: 'Invalid Master Recovery Code.' });
        }

        // Wipe TOTP secret
        user.twoFactorSecret = undefined;
        user.isTwoFactorEnabled = false;

        await user.save();

        res.json({ success: true, msg: '2FA has been reset using Master Code. Please scan the new QR code.' });
    } catch (err) {
        console.error('resetWithMasterCode error:', err.message);
        res.status(500).json({ msg: 'Server error during emergency reset.' });
    }
};

const getAdmins = async (req, res) => {
    try {
        const admins = await User.find({ isAdmin: true }).select('-password -twoFactorSecret');
        res.json(admins);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// GET all regular users (non-admin, non-superadmin)
const getUsers = async (req, res) => {
    try {
        const users = await User.find({ isAdmin: { $ne: true }, isSuperAdmin: { $ne: true } })
            .select('-password -twoFactorSecret -backupCodes -otp -otpExpires')
            .sort({ createdAt: -1 });
        res.json({ users, total: users.length });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const updateAdminPermissions = async (req, res) => {
    try {
        const { permissions } = req.body;
        const user = await User.findById(req.params.id);
        if (!user || !user.isAdmin) return res.status(404).json({ msg: 'Admin not found' });
        
        user.permissions = permissions;
        await user.save();
        res.json({ success: true, user });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getGeofenceSettings = async (req, res) => {
    try {
        let locationsSetting = await SystemSettings.findOne({ key: 'officeLocations' });
        let locations = [];

        if (!locationsSetting) {
            let latSetting = await SystemSettings.findOne({ key: 'officeLatitude' });
            let lonSetting = await SystemSettings.findOne({ key: 'officeLongitude' });
            let radSetting = await SystemSettings.findOne({ key: 'allowedRadius' });

            const defaultLoc = {
                id: 'default-rajkot',
                name: 'Rajkot Head Office',
                latitude: latSetting ? parseFloat(latSetting.value) : 22.302368784634364,
                longitude: lonSetting ? parseFloat(lonSetting.value) : 70.82868261801187,
                radius: radSetting ? parseFloat(radSetting.value) : 200
            };
            locations = [defaultLoc];

            locationsSetting = new SystemSettings({
                key: 'officeLocations',
                value: JSON.stringify(locations)
            });
            await locationsSetting.save();
        } else {
            try {
                locations = JSON.parse(locationsSetting.value);
            } catch (e) {
                locations = [{
                    id: 'default-rajkot',
                    name: 'Rajkot Head Office',
                    latitude: 22.302368784634364,
                    longitude: 70.82868261801187,
                    radius: 200
                }];
            }
        }

        res.json({ locations });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const updateGeofenceSettings = async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || !currentUser.isSuperAdmin) {
            return res.status(403).json({ msg: 'Access Denied: Only Super Administrators can update Geofencing boundaries.' });
        }

        const { locations } = req.body;
        if (!locations || !Array.isArray(locations)) {
            return res.status(400).json({ msg: 'Please provide an array of locations.' });
        }

        for (const loc of locations) {
            if (!loc.name || loc.latitude === undefined || loc.longitude === undefined || loc.radius === undefined) {
                return res.status(400).json({ msg: 'Each location must have a name, latitude, longitude, and radius.' });
            }
        }

        await SystemSettings.findOneAndUpdate(
            { key: 'officeLocations' },
            { value: JSON.stringify(locations) },
            { upsert: true, new: true }
        );

        res.json({ success: true, msg: 'Geofence locations updated successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getAdminLoginReport = async (req, res) => {
    try {
        const { month } = req.query; // YYYY-MM
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffset);

        const targetMonth = month || istDate.toISOString().slice(0, 7);
        const [yearStr, monthStr] = targetMonth.split('-');
        const year = parseInt(yearStr, 10);
        const monthNum = parseInt(monthStr, 10);

        const daysInMonth = new Date(year, monthNum, 0).getDate();

        let evaluateUpToDay = daysInMonth;
        const currentYear = istDate.getUTCFullYear();
        const currentMonth = istDate.getUTCMonth() + 1;
        const currentDay = istDate.getUTCDate();

        if (year === currentYear && monthNum === currentMonth) {
            evaluateUpToDay = currentDay;
        } else if (year > currentYear || (year === currentYear && monthNum > currentMonth)) {
            evaluateUpToDay = 0;
        }

        const admins = await User.find({
            isAdmin: true,
            isSuperAdmin: { $ne: true }
        }).select('_id name email phone companyName createdAt').sort({ name: 1 }).lean();

        const logs = await AdminLoginLog.find({
            dateStr: { $regex: `^${targetMonth}-` }
        }).sort({ loginAt: 1 }).lean();

        const reportData = admins.map(admin => {
            let presentDays = 0;
            let absentDays = 0;
            const dailyAttendance = [];

            for (let d = 1; d <= daysInMonth; d++) {
                const dayStr = String(d).padStart(2, '0');
                const fullDateStr = `${targetMonth}-${dayStr}`;

                const dayLogs = logs.filter(l => String(l.userId) === String(admin._id) && l.dateStr === fullDateStr);

                let status = 'Upcoming';
                let firstLogin = '-';
                let lastLogin = '-';
                let loginCount = 0;

                if (d <= evaluateUpToDay) {
                    const adminCreatedDateStr = admin.createdAt ? new Date(new Date(admin.createdAt).getTime() + istOffset).toISOString().slice(0, 10) : '2000-01-01';

                    if (fullDateStr < adminCreatedDateStr) {
                        status = 'Not Joined';
                    } else if (dayLogs.length >= 1) {
                        status = 'Present';
                        presentDays++;
                        loginCount = dayLogs.length;

                        const formatT = (dt) => {
                            const dObj = new Date(dt);
                            return dObj.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
                        };
                        firstLogin = formatT(dayLogs[0].loginAt);
                        lastLogin = dayLogs.length > 1 ? formatT(dayLogs[dayLogs.length - 1].loginAt) : firstLogin;
                    } else {
                        status = 'Absent';
                        absentDays++;
                    }
                }

                dailyAttendance.push({
                    day: d,
                    dateStr: fullDateStr,
                    status,
                    firstLogin,
                    lastLogin,
                    loginCount
                });
            }

            const totalEvaluated = presentDays + absentDays;
            const attendancePercentage = totalEvaluated > 0 ? Math.round((presentDays / totalEvaluated) * 100) : 0;

            return {
                _id: admin._id,
                name: admin.name || admin.email,
                email: admin.email,
                phone: admin.phone,
                companyName: admin.companyName,
                createdAt: admin.createdAt,
                presentDays,
                absentDays,
                totalEvaluated,
                attendancePercentage,
                dailyAttendance
            };
        });

        res.json({
            success: true,
            month: targetMonth,
            daysInMonth,
            evaluateUpToDay,
            data: reportData
        });
    } catch (err) {
        console.error('Error in getAdminLoginReport:', err);
        res.status(500).json({ success: false, message: 'Server Error generating admin attendance report' });
    }
};

module.exports = { register, login, phoneLogin, phoneRegister, getUserByPhone, sendOtp, verifyOtp, sendAdminOtp, verifyAdminOtp, createAdmin, setup2FA, verifyAndEnable2FA, loginWith2FA, resetWithBackupCode, getAdmins, updateAdminPermissions, getMe, getUsers, getGeofenceSettings, updateGeofenceSettings, getAdminLoginReport };

