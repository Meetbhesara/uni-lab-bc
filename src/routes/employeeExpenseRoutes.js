const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const employeeExpenseController = require('../controllers/employeeExpenseController');
const { employeeAuth } = require('../middlewares/employeeAuth');

// --- Multer Storage Logic (Reused for consistent folder structure) ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        try {
            // clientShortId and siteSubfolder should be provided by frontend
            // For site-specific files, we'll try to find the site details from the body
            let clientShortId = (req.body.clientShortId || 'unknown_client').toLowerCase();
            let siteSubfolder = (req.body.siteSubfolder || 'unknown_site').toLowerCase();

            // If fieldname is site_X_photos, we might need to adjust destination
            if (file.fieldname.startsWith('site_')) {
                const parts = file.fieldname.split('_');
                const idx = parseInt(parts[1]);
                const clientSites = JSON.parse(req.body.clientSites || '[]');
                
                if (clientSites[idx]) {
                    // We need to resolve the folder for this specific site
                    // This is tricky because we need the site/client names which aren't in req.body.clientSites (only IDs)
                    // But wait, the frontend should have sent metadata for all sites if we want perfection.
                    // For now, we'll use the root targetDir if we can't resolve individual ones,
                    // OR we'll assume the frontend sends 'site_0_folder', 'site_1_folder' etc.
                    
                    // Let's check if frontend sent specific metadata
                    if (req.body[`site_${idx}_clientShortId`]) clientShortId = req.body[`site_${idx}_clientShortId`].toLowerCase();
                    if (req.body[`site_${idx}_siteSubfolder`]) siteSubfolder = req.body[`site_${idx}_siteSubfolder`].toLowerCase();
                }
            }

            let targetDir;
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);

            if (file.fieldname.startsWith('expense_')) {
                const parts = file.fieldname.split('_'); // expense_petrol
                const expenseName = parts[1];
                const empId = req.body.empId || req.body.employeeId || 'unknown_employee';
                targetDir = useNas 
                    ? path.join(nasBase, 'employee_master', empId, expenseName)
                    : path.join(absoluteLocalBase, 'employee_master', empId, expenseName);
            } else if (file.fieldname.startsWith('otherExpense_')) {
                const parts = file.fieldname.split('_'); // otherExpense_0
                const empId = req.body.empId || req.body.employeeId || 'unknown_employee';
                targetDir = useNas 
                    ? path.join(nasBase, 'employee_master', empId, 'other_expenses')
                    : path.join(absoluteLocalBase, 'employee_master', empId, 'other_expenses');
            } else {
                if (useNas) {
                    targetDir = path.join(nasBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
                } else {
                    targetDir = path.join(absoluteLocalBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
                }
            }

            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            let finalDir = targetDir;
            if (!file.fieldname.startsWith('expense_') && !file.fieldname.startsWith('otherExpense_')) {
                // Initialize all 3 folders for consistency
                const subfolders = ['photos', 'Daily_report', 'data'];
                subfolders.forEach(sub => {
                    const subPath = path.join(targetDir, sub);
                    if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });
                });

                let sub = 'data'; 
                if (file.fieldname.includes('photos')) sub = 'photos';
                else if (file.fieldname.includes('dailyReports')) sub = 'Daily_report';
                else if (file.fieldname.includes('data')) sub = 'data';
                finalDir = path.join(targetDir, sub);
            }

            req.targetDirs = req.targetDirs || {};
            req.targetDirs[file.fieldname] = finalDir;
            cb(null, finalDir);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        let namePrefix = file.fieldname;
        const dateStr = req.body.date || new Date().toISOString().split('T')[0];

        if (file.fieldname.startsWith('expense_')) {
            const expenseName = file.fieldname.split('_')[1]; // e.g. petrol
            namePrefix = `${expenseName}-${dateStr}`;
        } else if (file.fieldname.startsWith('otherExpense_')) {
            namePrefix = `other_expenses-${dateStr}`;
        }

        let finalName = namePrefix + path.extname(file.originalname);
        const finalDir = req.targetDirs ? req.targetDirs[file.fieldname] : null;

        if (finalDir && fs.existsSync(finalDir)) {
            const existingFiles = fs.readdirSync(finalDir);
            let numFiles = 1;
            while(existingFiles.includes(finalName)) {
                finalName = `${namePrefix} (${numFiles})${path.extname(file.originalname)}`;
                numFiles++;
            }
        } else {
             // Fallback
             finalName = namePrefix + '-' + Date.now() + path.extname(file.originalname);
        }

        cb(null, finalName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|csv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml');
        if (extname || mimetype) return cb(null, true);
        cb(new Error('Invalid file type. Allowed: Images, PDFs, Docs, Excel.'));
    }
});

// Employee specific routes
router.post('/', employeeAuth, employeeExpenseController.addExpense);
router.get('/my-expenses', employeeAuth, employeeExpenseController.getExpensesForEmployee);

// Admin / Management routes
router.get('/all', employeeExpenseController.getAllExpenses);
router.get('/admin/:employeeId', employeeExpenseController.getExpensesByEmployee);

// Admin Add Expense with File Support (Using any() for dynamic site-wise fields)
router.post('/admin/add-expense', upload.any(), employeeExpenseController.adminAddExpense);

router.delete('/:id', employeeExpenseController.deleteExpense);

module.exports = router;
