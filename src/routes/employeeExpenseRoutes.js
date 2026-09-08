const { getSiteMasterPath } = require('../utils/pathHelper');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const employeeExpenseController = require('../controllers/employeeExpenseController');
const { employeeAuth } = require('../middlewares/employeeAuth');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');

// --- Multer Storage Logic (Reused for consistent folder structure) ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
        const rootBase = useNas ? nasBase : absoluteLocalBase;

        try {
            let clientShortId = req.body.clientShortId || 'unknown_client';
            let siteSubfolder = req.body.siteSubfolder || 'unknown_site';

            // If fieldname is site_X_photos, resolve specific metadata
            if (file.fieldname.startsWith('site_')) {
                const parts = file.fieldname.split('_');
                const idx = parseInt(parts[1]);
                if (req.body[`site_${idx}_clientShortId`]) clientShortId = req.body[`site_${idx}_clientShortId`];
                if (req.body[`site_${idx}_siteSubfolder`]) siteSubfolder = req.body[`site_${idx}_siteSubfolder`];
            }

            let finalDir;
            if (file.fieldname.startsWith('expense_')) {
                const parts = file.fieldname.split('_'); // expense_petrol
                let expenseName = parts[1];
                if (expenseName === 'petrol') {
                    expenseName = (req.body.fuelType || 'petrol').toLowerCase();
                }
                const empId = req.body.empId || req.body.employeeId || 'unknown_employee';
                finalDir = useNas 
                    ? path.join(nasBase, 'employee_master', empId, expenseName)
                    : path.join(absoluteLocalBase, 'employee_master', empId, expenseName);
                if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
            } else if (file.fieldname.startsWith('otherExpense_')) {
                const empId = req.body.empId || req.body.employeeId || 'unknown_employee';
                finalDir = useNas 
                    ? path.join(nasBase, 'employee_master', empId, 'other_expenses')
                    : path.join(absoluteLocalBase, 'employee_master', empId, 'other_expenses');
                if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
            } else {
                let sub = 'data'; 
                if (file.fieldname.includes('photos')) sub = 'photos';
                else if (file.fieldname.includes('dailyReports') || file.fieldname.includes('report')) sub = 'Daily_report';
                else if (file.fieldname.includes('drawing') || file.fieldname.includes('drafting')) sub = 'drawing';
                else if (file.fieldname.includes('data')) sub = 'data';

                finalDir = getSiteMasterPath(rootBase, clientShortId, siteSubfolder, sub);
                if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
            }

            req.targetDirs = req.targetDirs || {};
            req.targetDirs[file.fieldname] = finalDir;
            file.destination = finalDir;
            cb(null, finalDir);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        let name = file.originalname;
        if (file.fieldname.startsWith('expense_') || file.fieldname.startsWith('otherExpense_')) {
            name = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        }
        cb(null, name);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // Increased to 100MB to support large drawing files
    fileFilter: (req, file, cb) => {
        cb(null, true); // No restriction to any type of file
    }
});



const topographyBackupMiddleware = (req, res, next) => {
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        const { duplicateTopographySiteFile } = require('../utils/fileDuplicator');
        req.files.forEach(f => {
            if (f.path) {
                let explicitCat = null;
                if (f.fieldname.includes('data')) explicitCat = 'data';
                else if (f.fieldname.includes('dailyReports') || f.fieldname.includes('report')) explicitCat = 'report';
                else if (f.fieldname.includes('mail')) explicitCat = 'mail';

                const schedType = req.body[`${f.fieldname}_scheduleType`] || req.body.scheduleType || 'Topography Survey';
                if (explicitCat) {
                    duplicateTopographySiteFile(f.path, schedType, explicitCat);
                }
            }
        });
    }
    next();
};

const uploadLimitMiddleware = (req, res, next) => {
    if (!req.files || !req.files.length) return next();
    const counts = { photos: 0, dailyReports: 0, data: 0, drawing: 0 };
    req.files.forEach(f => {
        if (f.fieldname.includes('photos')) counts.photos++;
        else if (f.fieldname.includes('dailyReports')) counts.dailyReports++;
        else if (f.fieldname.includes('data')) counts.data++;
        else if (f.fieldname.includes('drawing')) counts.drawing++;
    });

    if (counts.photos > 100) return res.status(400).json({ success: false, message: 'Maximum 100 photos allowed per upload.' });
    if (counts.dailyReports > 50) return res.status(400).json({ success: false, message: 'Maximum 50 reports allowed per upload.' });
    if (counts.data > 50) return res.status(400).json({ success: false, message: 'Maximum 50 data files allowed per upload.' });
    if (counts.drawing > 50) return res.status(400).json({ success: false, message: 'Maximum 50 drawings allowed per upload.' });
    
    next();
};

// Employee specific routes
router.post('/', employeeAuth, upload.any(), uploadLimitMiddleware, topographyBackupMiddleware, employeeExpenseController.addExpense);
router.get('/my-expenses', employeeAuth, employeeExpenseController.getExpensesForEmployee);

// Admin / Management routes
router.get('/all', auth, checkPermission('employeeExpense_report_advanced', 'read'), employeeExpenseController.getAllExpenses);
router.get('/admin/:employeeId', auth, checkPermission('employeeExpense_report_advanced', 'read'), employeeExpenseController.getExpensesByEmployee);

// Admin Add Expense with File Support (Using any() for dynamic site-wise fields)
router.post('/admin/add-expense', auth, checkPermission('employeeExpense_daily', 'write'), upload.any(), uploadLimitMiddleware, topographyBackupMiddleware, employeeExpenseController.adminAddExpense);

router.delete('/:id/site/:siteIdx/file/:category/:fileId', auth, employeeExpenseController.deleteFile);
router.delete('/:id', auth, checkPermission('employeeExpense_daily', 'write'), employeeExpenseController.deleteExpense);

// Last 5 days summary — all employees
router.get('/report/daily-summary', auth, checkPermission('employeeExpense_report_last5days', 'read'), employeeExpenseController.getDailySummary);

// Attendance routes for unscheduled employees
router.get('/attendance', auth, checkPermission('employeeExpense_transfer_attendance', 'read'), employeeExpenseController.getAttendanceByDate);
router.post('/bulk-attendance', auth, checkPermission('employeeExpense_transfer_attendance', 'write'), employeeExpenseController.bulkSaveAttendance);

module.exports = router;
