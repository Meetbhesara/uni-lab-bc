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

// Dynamic Storage Configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        try {
            // Get client ObjectId from request
            const clientObjId = req.body.client;
            let clientShortId = 'unknown_client';

            if (clientObjId) {
                const ClientMaster = require('../models/ClientMaster');
                const clientRecord = await ClientMaster.findById(clientObjId);
                if (clientRecord && clientRecord.clientId) {
                    clientShortId = clientRecord.clientId.toLowerCase();
                }
            }

            // Sanitize site name and combine with siteId for folder naming
            const siteId = req.body.siteId || 'unknown_id';
            const siteNamePart = (req.body.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const siteSubfolder = `${siteId}-${siteNamePart}`;

            let targetDir;
            if (useNas) {
                targetDir = path.join(nasBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
            } else {
                const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
                targetDir = path.join(absoluteLocalBase, 'client_master', clientShortId, 'site_master', siteSubfolder);
            }

            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            // Initialize subfolders
            const subfolders = ['photos', 'Daily_report', 'data', 'drafting'];
            subfolders.forEach(sub => {
                const subPath = path.join(targetDir, sub);
                if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });
            });

            // Decide which subfolder to use based on the field name or documentType
            let sub = 'data'; // default
            if (file.fieldname === 'photos' || req.body.documentType === 'photos') sub = 'photos';
            else if (file.fieldname === 'dailyReports' || req.body.documentType === 'dailyReports') sub = 'Daily_report';
            else if (file.fieldname === 'data' || req.body.documentType === 'data') sub = 'data';
            else if (file.fieldname === 'draftingWorks' || req.body.documentType === 'drafting' || req.body.documentType === 'drawing') sub = 'drafting';
            else if (file.fieldname === 'docs') sub = ''; // Store directly in targetDir

            cb(null, path.join(targetDir, sub));
        } catch (err) {
            console.error('Multer destination error:', err);
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
    { name: 'draftingWorks', maxCount: 30 }
]), updateSiteMaster);
router.delete('/:id', deleteSiteMaster);
router.get('/', getSites);
router.get('/all-documents', getAllGlobalDocuments);

module.exports = router;
