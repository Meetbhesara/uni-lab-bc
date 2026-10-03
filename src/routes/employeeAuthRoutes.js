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

const { getAttendanceDetail, getAttendanceSummary } = require('../controllers/employeeMasterController');

router.get('/attendance-detail', employeeAuth, (req, res) => {
    req.params = req.params || {};
    req.params.id = req.employeeId;
    return getAttendanceDetail(req, res);
});

router.get('/attendance-summary', employeeAuth, (req, res) => {
    req.params = req.params || {};
    req.params.id = req.employeeId;
    return getAttendanceSummary(req, res);
});

module.exports = router;
