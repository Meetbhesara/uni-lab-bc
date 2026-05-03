const express = require('express');
const router = express.Router();
const { register, login, phoneLogin, phoneRegister, getUserByPhone, sendOtp, verifyOtp, sendAdminOtp, verifyAdminOtp, createAdmin, setup2FA, verifyAndEnable2FA, loginWith2FA, resetWithBackupCode } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/phone-login', phoneLogin);
router.post('/phone-register', phoneRegister);
router.get('/phone/:phone', getUserByPhone);

// OTP routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/send-admin-otp', sendAdminOtp);
router.post('/verify-admin-otp', verifyAdminOtp);
router.post('/create-admin', createAdmin);

// MFA / TOTP Routes
router.post('/setup-2fa', setup2FA);
router.post('/verify-enable-2fa', verifyAndEnable2FA);
router.post('/login-2fa', loginWith2FA);
router.post('/reset-with-backup', resetWithBackupCode);

module.exports = router;
