const SiteMaster = require('../models/SiteMaster');
const ClientMaster = require('../models/ClientMaster');
const path = require('path');
const fs = require('fs');

const storeSiteMaster = async (req, res) => {
    try {
        const { client, siteName, workForAppley, ledgerItems, contactPhone, siteAddress, siteLocation, contactPersons, status } = req.body;
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

        const prefix = `${clientShortId}-`;
        const sitesWithPrefix = await SiteMaster.find({ siteId: { $regex: `^${prefix}` } });

        let nextSeq = 1;
        if (sitesWithPrefix.length > 0) {
            const maxSuffix = Math.max(...sitesWithPrefix.map(s => {
                const parts = s.siteId.split('-');
                const suffix = parseInt(parts[parts.length - 1]);
                return isNaN(suffix) ? 0 : suffix;
            }));
            nextSeq = maxSuffix + 1;
        }
        const generatedSiteId = `${clientShortId}-${String(nextSeq).padStart(4, '0')}`;

        // --- Folder Creation Logic ---
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        const sanitizedSiteName = (siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const siteSubfolder = `${generatedSiteId}-${sanitizedSiteName}`;

        let targetDir;
        const cId = clientShortId.toLowerCase();
        if (useNas === 'true') {
            targetDir = path.join(nasBase, 'client_master', cId, 'site_master', siteSubfolder);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'client_master', cId, 'site_master', siteSubfolder);
        }

        // Always create the directory regardless of file uploads
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Initialize subfolders (photos, Daily_report, data)
        const subfolders = ['photos', 'Daily_report', 'data'];
        subfolders.forEach(sub => {
            const subPath = path.join(targetDir, sub);
            if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });
        });
        // -----------------------------

        const documents = [];

        const processFiles = (fieldFiles, subfolder) => {
            if (!fieldFiles) return;
            const flist = Array.isArray(fieldFiles) ? fieldFiles : [fieldFiles];
            flist.forEach(f => {
                documents.push({
                    name: f.originalname,
                    url: `/uploads/client_master/${clientShortId.toLowerCase()}/site_master/${siteSubfolder}/${subfolder ? subfolder + '/' : ''}${path.basename(f.path)}`,
                    path: f.path
                });
            });
        };

        if (files) {
            processFiles(files.docs, '');
            processFiles(files.photos, 'photos');
            processFiles(files.dailyReports, 'Daily_report');
        }

        let parsedContactPersons = [];
        let parsedLedgerItems = [];
        try {
            if (contactPersons) parsedContactPersons = typeof contactPersons === 'string' ? JSON.parse(contactPersons) : contactPersons;
            if (ledgerItems) parsedLedgerItems = typeof ledgerItems === 'string' ? JSON.parse(ledgerItems) : ledgerItems;
        } catch (e) { console.error('Parse error for arrays:', e); }

        const record = new SiteMaster({
            siteId: generatedSiteId,
            client: client || undefined,
            siteName,
            workForAppley,
            ledgerItems: parsedLedgerItems,
            contactPhone,
            siteAddress,
            siteLocation,
            contactPersons: parsedContactPersons,
            documents,
            status: status || 'Active'
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
        const { search } = req.query;
        let query = {};
        if (search) {
            query = {
                $or: [
                    { siteName: { $regex: search, $options: 'i' } },
                    { siteId: { $regex: search, $options: 'i' } },
                    { siteAddress: { $regex: search, $options: 'i' } },
                    { 'contactPersons.name': { $regex: search, $options: 'i' } },
                    { 'contactPersons.phone': { $regex: search, $options: 'i' } }
                ]
            };
        }
        const sites = await SiteMaster.find(query)
            .populate('client', 'clientName')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: sites });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSiteLedgers = async (req, res) => {
    try {
        const ledgers = await SiteMaster.distinct('ledgerItems.ledger');
        const formattedLedgers = ledgers.filter(l => l && l.trim() !== '');
        res.json({ success: true, data: formattedLedgers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSitesByLedger = async (req, res) => {
    try {
        const { ledgerName } = req.params;
        const sites = await SiteMaster.find({ 'ledgerItems.ledger': ledgerName }).populate('client', 'clientName');
        res.json({ success: true, data: sites });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateSiteMaster = async (req, res) => {
    try {
        const { id } = req.params;
        const { client, siteName, ledgerItems, siteAddress, siteLocation, contactPersons, status } = req.body;
        const files = req.files;

        const site = await SiteMaster.findById(id);
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

        // Update basic fields
        if (client) site.client = client;
        if (siteName) site.siteName = siteName;
        if (siteAddress) site.siteAddress = siteAddress;
        if (siteLocation) site.siteLocation = siteLocation;
        if (status) site.status = status;

        if (ledgerItems) {
            try {
                site.ledgerItems = typeof ledgerItems === 'string' ? JSON.parse(ledgerItems) : ledgerItems;
            } catch (e) { console.error('Parse error for ledgerItems:', e); }
        }

        if (contactPersons) {
            try {
                site.contactPersons = typeof contactPersons === 'string' ? JSON.parse(contactPersons) : contactPersons;
            } catch (e) { console.error('Parse error for contactPersons:', e); }
        }

        // Handle new document uploads if any
        if (files) {
            // Fetch client data to get shortId for URL
            const clientData = await ClientMaster.findById(site.client);
            const clientShortId = (clientData && clientData.clientId) ? clientData.clientId.toLowerCase() : 'unknown_client';
            const sanitizedSiteName = (site.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const siteSubfolder = `${site.siteId}-${sanitizedSiteName}`;

            const processUpdateFiles = (fieldFiles, subfolder) => {
                if (!fieldFiles) return;
                const flist = Array.isArray(fieldFiles) ? fieldFiles : [fieldFiles];
                flist.forEach(f => {
                    site.documents.push({
                        name: f.originalname,
                        url: `/uploads/client_master/${clientShortId}/site_master/${siteSubfolder}/${subfolder ? subfolder + '/' : ''}${path.basename(f.path)}`,
                        path: f.path
                    });
                });
            };

            processUpdateFiles(files.docs, '');
            processUpdateFiles(files.photos, 'photos');
            processUpdateFiles(files.dailyReports, 'Daily_report');
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

const getNextSiteId = async (req, res) => {
    try {
        const { clientId } = req.params; // This is the ClientMaster _id
        if (!clientId) return res.status(400).json({ success: false, message: 'Client ID is required' });

        const clientData = await ClientMaster.findById(clientId);
        if (!clientData) return res.status(404).json({ success: false, message: 'Client not found' });

        const clientShortId = clientData.clientId || '00000';
        const prefix = `${clientShortId}-`;
        const sitesWithPrefix = await SiteMaster.find({ siteId: { $regex: `^${prefix}` } });

        let nextSeq = 1;
        if (sitesWithPrefix.length > 0) {
            const maxSuffix = Math.max(...sitesWithPrefix.map(s => {
                const parts = s.siteId.split('-');
                const suffix = parseInt(parts[parts.length - 1]);
                return isNaN(suffix) ? 0 : suffix;
            }));
            nextSeq = maxSuffix + 1;
        }
        const generatedSiteId = `${clientShortId}-${String(nextSeq).padStart(4, '0')}`;

        res.json({ success: true, nextId: generatedSiteId });
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
    deleteSiteMaster,
    getNextSiteId
};
