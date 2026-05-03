const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeSiteMaster, getSites, getSiteLedgers, getSitesByLedger, updateSiteMaster, deleteSiteMaster } = require('../controllers/siteMasterController');
const SiteMaster = require('../models/SiteMaster');

// Add ledger routes
router.get('/ledgers', getSiteLedgers);
router.get('/by-ledger/:ledgerName', getSitesByLedger);

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
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        // Sanitize site name for folder naming
        const siteName = (req.body.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        let targetDir;
        if (useNas) {
            // User specifically asked for /volume1/work/site_master/{site_name}
            targetDir = path.join(nasBase, 'site_master', siteName);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'site_master', siteName);
        }

        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        cb(null, targetDir);
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

router.post('/', upload.fields([{ name: 'docs', maxCount: 10 }]), storeSiteMaster);
router.put('/:id', upload.fields([{ name: 'docs', maxCount: 10 }]), updateSiteMaster);
router.delete('/:id', deleteSiteMaster);
router.get('/', getSites);

module.exports = router;
