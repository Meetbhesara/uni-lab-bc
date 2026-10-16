const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');
const { register, login, phoneLogin, phoneRegister, getUserByPhone, sendOtp, verifyOtp, sendAdminOtp, verifyAdminOtp, createAdmin, getAdmins, updateAdminPermissions, updateAdmin, setup2FA, verifyAndEnable2FA, loginWith2FA, resetWithBackupCode, getMe, getUsers, updateUser, getGeofenceSettings, updateGeofenceSettings, getAdminLoginReport, logout, deleteAccount, syncUsersToGoogleContactsHandler } = require('../controllers/authController');

router.get('/me', auth, getMe);
router.post('/logout', auth, logout);

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
router.get('/admins', getAdmins);
router.delete('/admins/:id', deleteAccount);
router.patch('/admins/:id/permissions', updateAdminPermissions);
router.put('/admins/:id', updateAdmin);
router.patch('/admins/:id', updateAdmin);
router.get('/users', getUsers);
router.post('/sync-users-to-google-contacts', auth, syncUsersToGoogleContactsHandler);
router.put('/users/:id', updateUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteAccount);
router.delete('/account/:id', deleteAccount);
// MFA / TOTP Routes
router.post('/setup-2fa', setup2FA);
router.post('/verify-enable-2fa', verifyAndEnable2FA);
router.post('/login-2fa', loginWith2FA);
router.post('/reset-with-backup', resetWithBackupCode);

// Geofence boundaries
router.get('/geofence', auth, getGeofenceSettings);
router.post('/geofence', auth, updateGeofenceSettings);

// Admin Login Attendance Report
router.get('/admin-login-report', auth, checkPermission('employeeMaster_adminReport', 'read'), getAdminLoginReport);

module.exports = router;
