const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middlewares/auth');

const {
    getSchedules,
    getLastAssignment,
    getSitesByClient,
    createSchedule,
    updateSchedule,
    completeSchedule,
    rejectSchedule,
    updateInvoiceStatus,
    generateSchedulerInvoice,
    pauseMonth,
    resumeMonth,
    endMonth,
    uploadDraftingWorkFiles,
    deleteDraftingWorkFile,
    deleteSchedule,
    addInvoiceFollowUp
} = require('../controllers/scheduleMasterController');


// --- Multer Storage for Completion Files ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        try {
            // We expect clientId (short ID) and siteSubfolder in req.body
            let clientShortId = (req.body.clientShortId || 'unknown_client').toLowerCase();
            let siteSubfolder = (req.body.siteSubfolder || 'unknown_site').toLowerCase();

            // Attempt to resolve from DB using req.params.id (schedule ID)
            if (req.params && req.params.id) {
                try {
                    const ScheduleMaster = require('../models/ScheduleMaster');
                    const ClientMaster = require('../models/ClientMaster');
                    const SiteMaster = require('../models/SiteMaster');
                    
                    const sched = await ScheduleMaster.findById(req.params.id);
                    if (sched) {
                        const clientData = await ClientMaster.findById(sched.client);
                        if (clientData && clientData.clientId) {
                            clientShortId = clientData.clientId.toLowerCase();
                        }
                        const siteData = await SiteMaster.findById(sched.site);
                        if (siteData && siteData.siteName) {
                            siteSubfolder = siteData.siteName.trim().replace(/[<>:"\/\\|?*]+/g, '_');
                        }
                    }
                } catch (dbErr) {
                    console.error('Error fetching schedule details for multer:', dbErr);
                }
            }

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
                sub = 'drawing'; // save in drawing directory
            }
            else if (file.fieldname === 'mailFiles') {
                sub = 'Mail'; // save in Mail directory
            }

            const subPath = path.join(targetDir, sub);
            if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });

            file.destination = subPath;
            cb(null, subPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        
        let filename;
        if (['collectedFiles', 'convertedFiles', 'liningDrawFiles', 'esurveyWorkFiles', 'finalCheckingFiles', 'mailFiles'].includes(file.fieldname)) {
            filename = file.originalname;
        } else {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        }

        

        cb(null, filename);
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

// GET /api/schedule-master/last-assignment/:operativeId
router.get('/last-assignment/:operativeId', auth, getLastAssignment);
router.get('/sites-by-client/:clientId', getSitesByClient);
router.post('/', createSchedule);
router.put('/:id', auth, updateSchedule);

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

// POST /api/schedule-master/generate-invoice (Generate Proforma or Final invoice atomically for multiple entries)
router.post('/generate-invoice', generateSchedulerInvoice);


// DELETE /api/schedule-master/pause-month/:client/:site/:monthGroupId (Pause month schedule)
router.delete('/pause-month/:client/:site/:monthGroupId', pauseMonth);

// POST /api/schedule-master/resume-month (Resume month schedule)
router.post('/resume-month', resumeMonth);

// PUT /api/schedule-master/end-month/:client/:site/:monthGroupId (End month contract)
router.put('/end-month/:client/:site/:monthGroupId', endMonth);

// POST /api/schedule-master/drafting-work/:id (Upload drafting work files)
router.post('/drafting-work/:id', upload.fields([
    { name: 'collectedFiles', maxCount: 15 },
    { name: 'convertedFiles', maxCount: 15 },
    { name: 'liningDrawFiles', maxCount: 15 },
    { name: 'esurveyWorkFiles', maxCount: 15 },
    { name: 'finalCheckingFiles', maxCount: 15 },
    { name: 'mailFiles', maxCount: 15 }
]), uploadDraftingWorkFiles);

// PUT /api/schedule-master/drafting-work-status/:id/:category/:fileId (Update drafting work file status)
router.put('/drafting-work-status/:id/:category/:fileId', require('../controllers/scheduleMasterController').updateDraftingWorkFileStatus);

// DELETE /api/schedule-master/drafting-work/:id/:category/:fileId (Delete drafting work file)
router.delete('/drafting-work/:id/:category/:fileId', deleteDraftingWorkFile);

// DELETE /api/schedule-master/:id (Delete schedule entirely)
router.delete('/:id', deleteSchedule);

// POST /api/schedule-master/invoice/:invoiceId/follow-up (Add invoice follow-up)
router.post('/invoice/:invoiceId/follow-up', addInvoiceFollowUp);

module.exports = router;
