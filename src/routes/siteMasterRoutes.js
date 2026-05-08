const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeSiteMaster, getSites, getSiteLedgers, getSitesByLedger, updateSiteMaster, deleteSiteMaster, getNextSiteId } = require('../controllers/siteMasterController');
const SiteMaster = require('../models/SiteMaster');

// Add ledger routes
router.get('/ledgers', getSiteLedgers);
router.get('/by-ledger/:ledgerName', getSitesByLedger);
router.get('/next-id/:clientId', getNextSiteId);

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

            // Sanitize site name for folder naming
            const siteName = (req.body.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

            let targetDir;
            if (useNas) {
                // Structure: client_master/[clientId]/site_master/[siteName]
                targetDir = path.join(nasBase, 'client_master', clientShortId, 'site_master', siteName);
            } else {
                const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
                targetDir = path.join(absoluteLocalBase, 'client_master', clientShortId, 'site_master', siteName);
            }

            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            // Initialize subfolders
            const subfolders = ['photos', 'Daily_report', 'data'];
            subfolders.forEach(sub => {
                const subPath = path.join(targetDir, sub);
                if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });
            });

            // Decide which subfolder to use based on the field name
            let sub = 'data'; // default
            if (file.fieldname === 'photos') sub = 'photos';
            else if (file.fieldname === 'dailyReports') sub = 'Daily_report';
            else if (file.fieldname === 'data' || file.fieldname === 'docs') sub = 'data';

            cb(null, path.join(targetDir, sub));
        } catch (err) {
            console.error('Multer destination error:', err);
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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for site docs
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Images, PDFs, and Word docs are allowed'));
    }
});

router.post('/', upload.fields([
    { name: 'docs', maxCount: 30 },
    { name: 'photos', maxCount: 30 },
    { name: 'dailyReports', maxCount: 30 }
]), storeSiteMaster);

router.put('/:id', upload.fields([
    { name: 'docs', maxCount: 30 },
    { name: 'photos', maxCount: 30 },
    { name: 'dailyReports', maxCount: 30 }
]), updateSiteMaster);
router.delete('/:id', deleteSiteMaster);
router.get('/', getSites);

module.exports = router;
