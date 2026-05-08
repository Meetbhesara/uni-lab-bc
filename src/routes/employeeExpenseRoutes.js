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
            const clientShortId = (req.body.clientShortId || 'unknown_client').toLowerCase();
            const siteSubfolder = (req.body.siteSubfolder || 'unknown_site').toLowerCase();

            let targetDir;
            if (useNas) {
                targetDir = path.join(nasBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
            } else {
                const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
                targetDir = path.join(absoluteLocalBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
            }

            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            let sub = 'data'; 
            if (file.fieldname === 'photos') sub = 'photos';
            else if (file.fieldname === 'dailyReports') sub = 'Daily_report';

            const subPath = path.join(targetDir, sub);
            if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });

            cb(null, subPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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

// Admin Add Expense with File Support
router.post('/admin/add-expense', upload.fields([
    { name: 'photos', maxCount: 10 },
    { name: 'dailyReports', maxCount: 10 },
    { name: 'data', maxCount: 10 }
]), employeeExpenseController.adminAddExpense);

router.delete('/:id', employeeExpenseController.deleteExpense);

module.exports = router;
