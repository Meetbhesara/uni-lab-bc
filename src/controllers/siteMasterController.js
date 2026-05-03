const SiteMaster = require('../models/SiteMaster');
const ClientMaster = require('../models/ClientMaster');
const path = require('path');
const fs = require('fs');

const storeSiteMaster = async (req, res) => {
    try {
        const { client, siteName, workForAppley, ledger, amount, contactPhone, siteAddress, siteLocation, contactPersons } = req.body;
        const files = req.files;

        if (!client) {
            return res.status(400).json({ success: false, message: 'Client is required for site creation' });
        }

        // Fetch client to get their clientId
        const clientData = await ClientMaster.findById(client);
        if (!clientData) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

        const clientShortId = clientData.clientId || '00000';

        // Find existing sites for this client to determine next sequence
        const existingSites = await SiteMaster.find({ client });
        const nextSeq = existingSites.length + 1;
        const generatedSiteId = `${clientShortId}-${String(nextSeq).padStart(4, '0')}`;

        // --- Folder Creation Logic ---
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        const siteSubfolder = (siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        let targetDir;
        if (useNas === 'true') {
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
            siteId: generatedSiteId,
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

const updateSiteMaster = async (req, res) => {
    try {
        const { id } = req.params;
        const { client, siteName, ledger, amount, siteAddress, siteLocation, contactPersons } = req.body;
        const files = req.files;

        const site = await SiteMaster.findById(id);
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

        // Update basic fields
        if (client) site.client = client;
        if (siteName) site.siteName = siteName;
        if (ledger) site.ledger = ledger;
        if (amount) site.amount = Number(amount) || 0;
        if (siteAddress) site.siteAddress = siteAddress;
        if (siteLocation) site.siteLocation = siteLocation;

        if (contactPersons) {
            try {
                site.contactPersons = typeof contactPersons === 'string' ? JSON.parse(contactPersons) : contactPersons;
            } catch (e) { console.error('Parse error for contactPersons:', e); }
        }

        // Handle new document uploads if any
        if (files && files.docs) {
            const siteSubfolder = (site.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const flist = Array.isArray(files.docs) ? files.docs : [files.docs];
            flist.forEach(f => {
                site.documents.push({
                    name: f.originalname,
                    url: `/uploads/site_master/${siteSubfolder}/${path.basename(f.path)}`,
                    path: f.path
                });
            });
        }

        await site.save();
        res.json({ success: true, message: 'Site updated successfully', data: site });
    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteSiteMaster = async (req, res) => {
    try {
        const { id } = req.params;
        const site = await SiteMaster.findByIdAndDelete(id);
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
        res.json({ success: true, message: 'Site deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeSiteMaster,
    getSites,
    getSiteLedgers,
    getSitesByLedger,
    updateSiteMaster,
    deleteSiteMaster
};
