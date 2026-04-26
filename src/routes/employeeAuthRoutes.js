const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { sendEmployeeOtp, verifyEmployeeOtp, getEmployeeProfile } = require('../controllers/employeeAuthController');
const { employeeAuth } = require('../middlewares/employeeAuth');

// Public routes
router.post('/send-otp', sendEmployeeOtp);
router.post('/verify-otp', verifyEmployeeOtp);

// Protected route — only valid employee JWT can access
router.get('/profile', employeeAuth, getEmployeeProfile);

module.exports = router;
