const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeSiteMaster, getSites, getSiteLedgers, getSitesByLedger, updateSiteMaster, deleteSiteMaster, getNextSiteId, getAllGlobalDocuments, updateDocumentStatus, moveToMail, deleteGlobalDocument } = require('../controllers/siteMasterController');
const SiteMaster = require('../models/SiteMaster');

// Add ledger routes
router.get('/ledgers', getSiteLedgers);
router.get('/by-ledger/:ledgerName', getSitesByLedger);
router.get('/next-id/:clientId', getNextSiteId);
router.post('/move-to-mail', moveToMail);

// Debug route: GET /api/site-master/by-client/:clientId
router.get('/by-client/:clientId', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const { clientId } = req.params;
        console.log('[SiteRoute] Lookup clientId:', clientId);
        const sites = await SiteMaster.find({ client: new mongoose.Types.ObjectId(clientId) })
            .select('siteName siteAddress client');
        const all = await SiteMaster.find({}).select('siteName client');
        console.log('[SiteRoute] All sites:', JSON.stringify(all));
        res.json({ success: true, count: sites.length, data: sites, allSites: all });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const { getSiteMasterPath } = require('../utils/pathHelper');

// Dynamic Storage Configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
        const rootBase = useNas ? nasBase : absoluteLocalBase;

        try {
            // Get client ObjectId and site details from request or DB if updating
            let clientObjId = req.body.client;
            let siteId = req.body.siteId;
            let siteName = req.body.siteName;

            if (req.params && req.params.id) {
                try {
                    const existingSite = await SiteMaster.findById(req.params.id).populate('client');
                    if (existingSite) {
                        if (!clientObjId) clientObjId = existingSite.client?._id || existingSite.client;
                        if (!siteId) siteId = existingSite.siteId;
                        if (!siteName) siteName = existingSite.siteName;
                    }
                } catch (e) { console.error('Error looking up existing site in multer:', e); }
            }

            let clientShortId = 'unknown_client';
            if (clientObjId) {
                const ClientMaster = require('../models/ClientMaster');
                const clientRecord = await ClientMaster.findById(clientObjId);
                if (clientRecord && clientRecord.clientId) {
                    clientShortId = clientRecord.clientId;
                }
            }

            // Sanitize site name and combine with siteId for folder naming
            siteId = siteId || 'unknown_id';
            const siteNamePart = (siteName || 'unknown_site').trim().replace(/[<>:"/\\|?*]+/g, '_');
            const siteSubfolder = `${siteId}-${siteNamePart}`;

            // Decide which subfolder to use based on the field name or documentType
            let sub = 'data'; // default
            if (file.fieldname === 'photos' || req.body.documentType === 'photos') sub = 'photos';
            else if (file.fieldname === 'dailyReports' || req.body.documentType === 'dailyReports') sub = 'Daily_report';
            else if (file.fieldname === 'data' || req.body.documentType === 'data') sub = 'data';
            else if (file.fieldname === 'draftingWorks' || req.body.documentType === 'drafting' || req.body.documentType === 'drawing') sub = 'drawing';
            else if (file.fieldname === 'docs') sub = ''; // Store directly in targetDir

            // Pass siteId for prefix-based folder lookup (avoids case-sensitivity duplicates on NAS)
            const targetDir = getSiteMasterPath(rootBase, clientShortId, siteSubfolder, sub, siteId);
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            cb(null, targetDir);
        } catch (err) {
            console.error('Multer destination error in siteMasterRoutes:', err);
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for site docs and CAD drafts
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|dwg|dxf|xls|xlsx|csv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = true; // allow all mimetypes for CAD which can vary wildly
        if (extname) return cb(null, true);
        cb(new Error('Invalid file type uploaded'));
    }
});

router.post('/', upload.fields([
    { name: 'docs', maxCount: 30 },
    { name: 'photos', maxCount: 30 },
    { name: 'dailyReports', maxCount: 30 },
    { name: 'draftingWorks', maxCount: 30 },
    { name: 'data', maxCount: 30 }
]), storeSiteMaster);

const { uploadRevision } = require('../controllers/siteMasterController');
router.post('/upload-revision', upload.single('document'), uploadRevision);

router.put('/document-status', updateDocumentStatus);
router.delete('/delete-document/:id', deleteGlobalDocument);

router.put('/:id', upload.fields([
    { name: 'docs', maxCount: 30 },
    { name: 'photos', maxCount: 30 },
    { name: 'dailyReports', maxCount: 30 },
    { name: 'draftingWorks', maxCount: 30 },
    { name: 'data', maxCount: 30 }
]), updateSiteMaster);
router.delete('/:id', deleteSiteMaster);
router.get('/', getSites);
router.get('/all-documents', getAllGlobalDocuments);

module.exports = router;
