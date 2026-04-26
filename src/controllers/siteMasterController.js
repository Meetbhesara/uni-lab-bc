const SiteMaster = require('../models/SiteMaster');
const path = require('path');
const fs = require('fs');

const storeSiteMaster = async (req, res) => {
    try {
        const { client, siteName, workForAppley, ledger, amount, contactPhone, siteAddress, siteLocation, contactPersons } = req.body;
        const files = req.files;

        // --- Folder Creation Logic ---
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        const siteSubfolder = (siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        let targetDir;
        if (useNas) {
            targetDir = path.join(nasBase, 'site_master', siteSubfolder);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'site_master', siteSubfolder);
        }

        // Always create the directory regardless of file uploads
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        // -----------------------------

        const documents = [];

        if (files && files.docs) {
            const flist = Array.isArray(files.docs) ? files.docs : [files.docs];
            flist.forEach(f => {
                documents.push({
                    name: f.originalname,
                    url: `/uploads/site_master/${siteSubfolder}/${path.basename(f.path)}`,
                    path: f.path
                });
            });
        }

        let parsedContactPersons = [];
        try {
            if (contactPersons) parsedContactPersons = typeof contactPersons === 'string' ? JSON.parse(contactPersons) : contactPersons;
        } catch(e) { console.error('Parse error for arrays:', e); }

        const record = new SiteMaster({
            client: client || undefined,
            siteName,
            workForAppley,
            ledger,
            amount: Number(amount) || 0,
            contactPhone,
            siteAddress,
            siteLocation,
            contactPersons: parsedContactPersons,
            documents
        });

        await record.save();
        res.status(201).json({
            success: true,
            message: 'Site record stored successfully',
            data: record
        });
    } catch (error) {
        console.error('Error in storeSiteMaster:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during storage',
            error: error.message
        });
    }
};

const getSites = async (req, res) => {
    try {
        const sites = await SiteMaster.find()
            .populate('client', 'clientName')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: sites });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSiteLedgers = async (req, res) => {
    try {
        const ledgers = await SiteMaster.distinct('ledger');
        const formattedLedgers = ledgers.filter(l => l && l.trim() !== '');
        res.json({ success: true, data: formattedLedgers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSitesByLedger = async (req, res) => {
    try {
        const { ledgerName } = req.params;
        const sites = await SiteMaster.find({ ledger: ledgerName }).populate('client', 'clientName');
        res.json({ success: true, data: sites });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeSiteMaster,
    getSites,
    getSiteLedgers,
    getSitesByLedger
};
