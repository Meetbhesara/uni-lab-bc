const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createSchedule, updateSchedule, getSchedules, getSitesByClient, completeSchedule, rejectSchedule } = require('../controllers/scheduleMasterController');

// --- Multer Storage for Completion Files ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        try {
            // We expect clientId (short ID) and siteSubfolder in req.body
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
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|csv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml');
        if (extname || mimetype) return cb(null, true);
        cb(new Error('Invalid file type. Allowed: Images, PDFs, Docs, Excel.'));
    }
});
// -------------------------------------------

// GET  /api/schedule-master?date=2024-01-15  (date-wise)
router.get('/', getSchedules);
router.get('/sites-by-client/:clientId', getSitesByClient);
router.post('/', createSchedule);
router.put('/:id', updateSchedule);

// POST /api/schedule-master/complete/:id (Complete with files)
router.post('/complete/:id', upload.fields([
    { name: 'photos', maxCount: 20 },
    { name: 'dailyReports', maxCount: 20 },
    { name: 'data', maxCount: 20 }
]), completeSchedule);

// PUT /api/schedule-master/reject/:id (Reject a schedule)
router.put('/reject/:id', rejectSchedule);

module.exports = router;
