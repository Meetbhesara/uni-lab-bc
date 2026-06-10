const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
    getSchedules,
    createSchedule,
    updateSchedule,
    completeSchedule,
    rejectSchedule,
    getSitesByClient,
    updateInvoiceStatus,
    pauseMonth,
    resumeMonth,
    endMonth,
    uploadDraftingWorkFiles,
    deleteDraftingWorkFile,
    deleteSchedule
} = require('../controllers/scheduleMasterController');

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
            else if (['collectedFiles', 'convertedFiles', 'liningDrawFiles', 'esurveyWorkFiles', 'finalCheckingFiles'].includes(file.fieldname)) {
                sub = 'drafting'; // save in drafting directory
            }

            const subPath = path.join(targetDir, sub);
            if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });

            cb(null, subPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        if (['collectedFiles', 'convertedFiles', 'liningDrawFiles', 'esurveyWorkFiles', 'finalCheckingFiles'].includes(file.fieldname)) {
            cb(null, file.originalname); // Use original filename for drafting works
        } else {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 150 * 1024 * 1024 }, // 150MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|csv|dwg|dxf|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml') || file.mimetype.includes('dwg') || file.mimetype.includes('dxf') || file.mimetype.includes('zip');
        if (extname || mimetype) return cb(null, true);
        cb(new Error('Invalid file type. Allowed: Images, PDFs, Docs, Excel, DWG, DXF, ZIP, RAR.'));
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

// PATCH /api/schedule-master/invoice-status/:id (Update invoice bill status)
router.patch('/invoice-status/:id', updateInvoiceStatus);

// DELETE /api/schedule-master/pause-month/:client/:site/:monthGroupId (Pause month schedule)
router.delete('/pause-month/:client/:site/:monthGroupId', pauseMonth);

// POST /api/schedule-master/resume-month (Resume month schedule)
router.post('/resume-month', resumeMonth);

// PUT /api/schedule-master/end-month/:client/:site/:monthGroupId (End month contract)
router.put('/end-month/:client/:site/:monthGroupId', endMonth);

// POST /api/schedule-master/drafting-work/:id (Upload drafting work files)
router.post('/drafting-work/:id', upload.fields([
    { name: 'collectedFiles', maxCount: 10 },
    { name: 'convertedFiles', maxCount: 10 },
    { name: 'liningDrawFiles', maxCount: 10 },
    { name: 'esurveyWorkFiles', maxCount: 10 },
    { name: 'finalCheckingFiles', maxCount: 10 }
]), uploadDraftingWorkFiles);

// PUT /api/schedule-master/drafting-work-status/:id/:category/:fileId (Update drafting work file status)
router.put('/drafting-work-status/:id/:category/:fileId', require('../controllers/scheduleMasterController').updateDraftingWorkFileStatus);

// DELETE /api/schedule-master/drafting-work/:id/:category/:fileId (Delete drafting work file)
router.delete('/drafting-work/:id/:category/:fileId', deleteDraftingWorkFile);

// DELETE /api/schedule-master/:id (Delete schedule entirely)
router.delete('/:id', deleteSchedule);

module.exports = router;
