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


const updateDocumentStatus = async (req, res) => {
    try {
        const { documentId, source, newStatus, expenseId, linkedDocumentId } = req.body;
        if (!documentId || !source || !newStatus) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        let updated = false;

        if (source === 'SiteMaster') {
            const SiteMaster = require('../models/SiteMaster');
            const mongoose = require('mongoose');
            const docIdObj = new mongoose.Types.ObjectId(documentId);
            const result = await SiteMaster.updateOne(
                { "documents._id": docIdObj },
                { $set: { "documents.$.status": newStatus, ...(newStatus === 'Completed' ? { "documents.$.approvalDate": new Date() } : {}) } }
            );
            
            if (newStatus === 'Completed' && linkedDocumentId) {
                const linkedIdObj = new mongoose.Types.ObjectId(linkedDocumentId);
                await SiteMaster.updateOne(
                    { "documents._id": linkedIdObj },
                    { $set: { "documents.$.status": 'Completed', "documents.$.approvalDate": new Date() } }
                );
            }
            
            if (result.modifiedCount > 0) updated = true;
        } else if (source === 'EmployeeExpense' && expenseId) {
            const EmployeeExpense = require('../models/EmployeeExpense');
            
            const mongoose = require('mongoose');
            const docIdObj = new mongoose.Types.ObjectId(documentId);
            const arraysToUpdate = ['photos', 'dailyReports', 'data', 'drawing'];
            let foundArrayName = null;
            
            for (const arrayName of arraysToUpdate) {
                const docExists = await EmployeeExpense.findOne({ _id: expenseId, [`clientSites.files.${arrayName}._id`]: docIdObj });
                if (docExists) {
                    foundArrayName = arrayName;
                    break;
                }
            }

            if (foundArrayName) {
                const targetPath = `clientSites.$[].files.${foundArrayName}.$[doc].status`;
                const datePath = `clientSites.$[].files.${foundArrayName}.$[doc].approvalDate`;
                const result = await EmployeeExpense.updateOne(
                    { _id: expenseId },
                    { $set: { [targetPath]: newStatus, ...(newStatus === 'Completed' ? { [datePath]: new Date() } : {}) } },
                    { arrayFilters: [{ "doc._id": docIdObj }] }
                );
                
                if (newStatus === 'Completed' && linkedDocumentId) {
                    const linkedIdObj = new mongoose.Types.ObjectId(linkedDocumentId);
                    await EmployeeExpense.updateOne(
                        { _id: expenseId },
                        { $set: { [targetPath]: 'Completed', [datePath]: new Date() } },
                        { arrayFilters: [{ "doc._id": linkedIdObj }] }
                    );
                }
                
                updated = true;
            }
        }

        if (updated) {
            res.json({ success: true, message: 'Status updated successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Document not found or status not changed' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteGlobalDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const { source, expenseId } = req.query;

        if (!source) {
            return res.status(400).json({ success: false, message: 'Missing source' });
        }

        const mongoose = require('mongoose');
        const docIdObj = new mongoose.Types.ObjectId(id);
        let deleted = false;

        if (source === 'SiteMaster') {
            const SiteMaster = require('../models/SiteMaster');
            const result = await SiteMaster.updateOne(
                { "documents._id": docIdObj },
                { $pull: { documents: { _id: docIdObj } } }
            );
            if (result.modifiedCount > 0) deleted = true;
        } else if (source === 'EmployeeExpense' && expenseId) {
            const EmployeeExpense = require('../models/EmployeeExpense');
            const arraysToUpdate = ['photos', 'dailyReports', 'data', 'drawing'];
            
            for (const arrayName of arraysToUpdate) {
                const targetPath = `clientSites.$[].files.${arrayName}`;
                const result = await EmployeeExpense.updateOne(
                    { _id: expenseId, [`clientSites.files.${arrayName}._id`]: docIdObj },
                    { $pull: { [targetPath]: { _id: docIdObj } } }
                );
                if (result.modifiedCount > 0) {
                    deleted = true;
                    break;
                }
            }
        }

        if (deleted) {
            res.json({ success: true, message: 'Document deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'Document not found' });
        }
    } catch (error) {
        console.error("Delete Global Document Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const moveToMail = async (req, res) => {
    try {
        const { documentIds } = req.body; // array of objects: { documentId, source, expenseId }
        if (!documentIds || !Array.isArray(documentIds)) {
            return res.status(400).json({ success: false, message: 'Missing documentIds array' });
        }

        const SiteMaster = require('../models/SiteMaster');
        const EmployeeExpense = require('../models/EmployeeExpense');
        const mongoose = require('mongoose');
        const fs = require('fs');
        const path = require('path');

        let movedCount = 0;
        
        // Generate a single folder name for this batch move
        // Format: Mail DD-MM-YYYY HH-MM-SS
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const mailFolderName = `Mail ${dd}-${mm}-${yyyy} ${hh}-${min}-${ss}`;

        for (const docInfo of documentIds) {
            const { documentId, source, expenseId } = docInfo;
            const docIdObj = new mongoose.Types.ObjectId(documentId);

            let physicalPath = null;
            let fileName = null;

            if (source === 'SiteMaster') {
                const site = await SiteMaster.findOne({ "documents._id": docIdObj });
                if (site) {
                    const doc = site.documents.find(d => d._id.toString() === documentId);
                    if (doc) {
                        physicalPath = doc.path;
                        fileName = doc.name;
                        await SiteMaster.updateOne(
                            { "documents._id": docIdObj },
                            { $set: { "documents.$.inMail": true, "documents.$.mailFolderName": mailFolderName } }
                        );
                    }
                }
            } else if (source === 'EmployeeExpense' && expenseId) {
                const exp = await EmployeeExpense.findOne({ _id: expenseId });
                if (exp && exp.clientSites) {
                    for (const cs of exp.clientSites) {
                        for (const arr of ['photos', 'dailyReports', 'data', 'drawing']) {
                            if (cs.files && cs.files[arr]) {
                                const doc = cs.files[arr].find(d => d._id.toString() === documentId);
                                if (doc) {
                                    physicalPath = doc.path;
                                    fileName = doc.name;
                                    const targetPath = `clientSites.$[].files.${arr}.$[doc].inMail`;
                                    const targetFolder = `clientSites.$[].files.${arr}.$[doc].mailFolderName`;
                                    await EmployeeExpense.updateOne(
                                        { _id: expenseId },
                                        { $set: { [targetPath]: true, [targetFolder]: mailFolderName } },
                                        { arrayFilters: [{ "doc._id": docIdObj }] }
                                    );
                                }
                            }
                        }
                    }
                }
            }

            if (physicalPath && fs.existsSync(physicalPath)) {
                // Determine Mail folder path
                // Original path example: /uploads/client_master/ibm/site_master/123-site/drawing/file.pdf
                const currentDir = path.dirname(physicalPath); // .../drawing
                const siteMasterDir = path.dirname(currentDir); // .../123-site
                
                const mailDir = path.join(siteMasterDir, 'Mail', mailFolderName);
                if (!fs.existsSync(mailDir)) {
                    fs.mkdirSync(mailDir, { recursive: true });
                }

                const destPath = path.join(mailDir, fileName);
                fs.copyFileSync(physicalPath, destPath);
                movedCount++;
            }
        }

        res.json({ success: true, message: `Moved ${movedCount} documents to Mail folder` });
    } catch (error) {
        console.error('moveToMail error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllGlobalDocuments = async (req, res) => {
    try {
        const SiteMaster = require('../models/SiteMaster');
        const EmployeeExpense = require('../models/EmployeeExpense');
        const ScheduleMaster = require('../models/ScheduleMaster');

        const { client, site, scheduleDate, scheduleId } = req.query;

        let siteQuery = {};
        if (client) siteQuery.client = client;
        if (site) siteQuery._id = site;
        
        let validSiteIdsFromSchedule = new Set();
        if (scheduleDate) {
            const sDate = new Date(scheduleDate);
            const nDate = new Date(sDate);
            nDate.setDate(sDate.getDate() + 1);
            
            const scheds = await ScheduleMaster.find({
                scheduleDate: { $gte: sDate, $lt: nDate }
            });
            scheds.forEach(sc => validSiteIdsFromSchedule.add(sc.site._id.toString()));
            
            if (site && !validSiteIdsFromSchedule.has(site)) {
                return res.json({ success: true, count: 0, data: [] });
            }
        }

        const sites = await SiteMaster.find(siteQuery).populate('client', 'clientName');
        const siteIds = sites.map(s => s._id);

        const schedules = await ScheduleMaster.find({
            site: { $in: siteIds }
        });
        const siteSchedulesMap = {};
        schedules.forEach(sched => {
            const sId = sched.site._id.toString();
            if (!siteSchedulesMap[sId]) siteSchedulesMap[sId] = [];
            siteSchedulesMap[sId].push(sched.scheduleDate);
        });

        let expenseQuery = { 'clientSites.siteId': { $in: siteIds } };
        const expenses = await EmployeeExpense.find(expenseQuery)
            .populate('clientSites.clientId', 'clientName')
            .populate('clientSites.siteId', 'siteName siteId');

        let allDocs = [];

        sites.forEach(site => {
            if (scheduleDate && !validSiteIdsFromSchedule.has(site._id.toString())) {
                return;
            }
            if (site.documents && site.documents.length > 0) {
                site.documents.forEach(doc => {
                    let docType = 'document';
                    if (doc.url.includes('/photos/')) docType = 'photo';
                    else if (doc.url.includes('/Daily_report/')) docType = 'report';
                    else if (doc.url.includes('/data/')) docType = 'data';
                    else if (doc.url.includes('/drafting/')) docType = 'drawing';

                    allDocs.push({
                        _id: doc._id,
                        documentName: doc.name,
                        documentType: docType,
                        documentUrl: doc.url,
                        source: 'SiteMaster',
                        client: site.client,
                        site: { _id: site._id, siteName: site.siteName, siteId: site.siteId },
                        receivedDate: doc.uploadedAt || site.createdAt || new Date(),
                        status: doc.status || 'Received',
                        isDraft: !!doc.isDraft,
                        linkedDocumentId: doc.linkedDocumentId,
                        approvalDate: doc.approvalDate,
                        inMail: !!doc.inMail,
                        mailFolderName: doc.mailFolderName || 'Unknown Mail',
                        priority: 'Normal',
                        uploadedBy: 'Admin',
                        scheduleDates: siteSchedulesMap[site._id.toString()] || []
                    });
                });
            }
        });

        expenses.forEach(expense => {
            if (expense.clientSites && expense.clientSites.length > 0) {
                expense.clientSites.forEach(cs => {
                    const cIdStr = cs.clientId ? cs.clientId._id.toString() : null;
                    const sIdStr = cs.siteId ? cs.siteId._id.toString() : null;

                    if (client && cIdStr !== client) return;
                    if (site && sIdStr !== site) return;
                    
                    if (scheduleDate) {
                        const sDate = new Date(scheduleDate);
                        const nDate = new Date(sDate);
                        nDate.setDate(sDate.getDate() + 1);
                        const eDate = new Date(expense.date);
                        
                        if (eDate < sDate || eDate >= nDate) return;
                        if (sIdStr && !validSiteIdsFromSchedule.has(sIdStr)) return;
                    }
                    
                    if (scheduleId && cs.scheduleId && cs.scheduleId.toString() !== scheduleId) {
                        return; // strictly skip files belonging to other schedules on the same day/site
                    }

                    const addFiles = (fileArray, type) => {
                        if (fileArray && fileArray.length > 0) {
                            fileArray.forEach(f => {
                                allDocs.push({
                                    _id: f._id || expense._id,
                                    documentName: f.name,
                                    documentType: type,
                                    documentUrl: f.url,
                                    source: 'EmployeeExpense',
                                    expenseId: expense._id,
                                    scheduleId: cs.scheduleId,
                                    client: cs.clientId,
                                    site: cs.siteId,
                                    receivedDate: f.uploadedAt || expense.date || new Date(),
                                    status: f.status || 'Received',
                                    isDraft: !!f.isDraft,
                                    linkedDocumentId: f.linkedDocumentId,
                                    approvalDate: f.approvalDate,
                                    inMail: !!f.inMail,
                                    mailFolderName: f.mailFolderName || 'Unknown Mail',
                                    priority: 'Normal',
                                    uploadedBy: 'Employee',
                                    scheduleDates: sIdStr && siteSchedulesMap[sIdStr] ? siteSchedulesMap[sIdStr] : []
                                });
                            });
                        }
                    };

                    if (cs.files) {
                        addFiles(cs.files.photos, 'photo');
                        addFiles(cs.files.dailyReports, 'report');
                        addFiles(cs.files.data, 'data');
                        addFiles(cs.files.drawing, 'drawing');
                    }
                });
            }
        });

        allDocs.sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate));

        res.json({ success: true, count: allDocs.length, data: allDocs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const uploadRevision = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { source, expenseId, clientId, siteId, documentType, linkedDocumentId } = req.body;
        
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (process.env.USE_NAS === 'true' && !nasBase.startsWith('/')) {
            nasBase = '/' + nasBase;
        }
        
        let urlPath = req.file.path.replace(/\\/g, '/');
        if (process.env.USE_NAS === 'true' && urlPath.startsWith(nasBase)) {
            urlPath = urlPath.substring(nasBase.length);
        } else {
            const uploadIndex = urlPath.indexOf('/uploads/');
            if (uploadIndex !== -1) {
                urlPath = urlPath.substring(uploadIndex);
            }
        }
        if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
        if (!urlPath.startsWith('/uploads')) urlPath = '/uploads' + urlPath;
        
        const newDoc = {
            name: req.file.originalname,
            url: urlPath,
            path: req.file.path,
            status: req.body.status || 'Under Review',
            isDraft: true,
            linkedDocumentId: linkedDocumentId || null
        };

        if (source === 'SiteMaster') {
            const SiteMaster = require('../models/SiteMaster');
            await SiteMaster.updateOne(
                { _id: siteId },
                { $push: { documents: newDoc } }
            );
        } else if (source === 'EmployeeExpense') {
            const EmployeeExpense = require('../models/EmployeeExpense');
            const mongoose = require('mongoose');
            let actualArrayName = documentType;
            if (documentType === 'photo' || documentType === 'photos') actualArrayName = 'photos';
            else if (documentType === 'report' || documentType === 'dailyReports') actualArrayName = 'dailyReports';
            else if (documentType === 'data') actualArrayName = 'data';
            else if (documentType === 'drawing') actualArrayName = 'drawing';
            
            const targetArray = `clientSites.$[cs].files.${actualArrayName}`;
            const siteIdObj = new mongoose.Types.ObjectId(siteId);
            await EmployeeExpense.updateOne(
                { _id: expenseId },
                { $push: { [targetArray]: newDoc } },
                { arrayFilters: [{ "cs.siteId": siteIdObj }] }
            );
        } else {
            return res.status(400).json({ success: false, message: 'Invalid source' });
        }

        res.json({ success: true, message: 'Revision uploaded successfully', data: newDoc });
    } catch (error) {
        console.error("Revision Upload Error:", error);
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
    getNextSiteId,
    moveToMail,
    getAllGlobalDocuments,
    updateDocumentStatus,
    uploadRevision,
    deleteGlobalDocument
};
