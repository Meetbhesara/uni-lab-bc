const DraftingWork = require('../models/DraftingWork');
const path = require('path');
const fs = require('fs');

// Fetch all documents
exports.getAllDrafts = async (req, res) => {
    try {
        const { client, site, status } = req.query;
        let filter = {};
        if (client) filter.client = client;
        if (site) filter.site = site;
        if (status) filter.status = status;

        const drafts = await DraftingWork.find(filter)
            .populate('client', 'clientName clientId')
            .populate('site', 'siteName siteId')
            .sort({ receivedDate: -1 });

        res.status(200).json({ success: true, count: drafts.length, data: drafts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Upload a document
exports.uploadDraft = async (req, res) => {
    try {
        const { client, site, priority, status, assignedTo, deadline, trackingNotes } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Please upload a file' });
        }

        const documentName = req.file.originalname;
        // Use regex to get ext
        const documentType = path.extname(documentName).substring(1).toLowerCase();
        const documentPath = req.file.path.replace(/\\/g, '/');
        const documentUrl = `/api/drafts/file/${path.basename(documentPath)}`; // Or serve statically

        const draft = await DraftingWork.create({
            documentName,
            documentType,
            documentUrl,
            documentPath,
            client,
            site,
            priority,
            status,
            assignedTo,
            deadline,
            trackingNotes,
            uploadedBy: req.user ? req.user.name : 'Admin'
        });

        res.status(201).json({ success: true, data: draft });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Update Document Tracking / Status
exports.updateDraft = async (req, res) => {
    try {
        const { status, progress, assignedTo, deadline, trackingNotes, version, approvedBy, isFinal } = req.body;
        
        let draft = await DraftingWork.findById(req.params.id);
        if (!draft) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }

        draft.status = status || draft.status;
        draft.progress = progress !== undefined ? progress : draft.progress;
        draft.assignedTo = assignedTo || draft.assignedTo;
        draft.deadline = deadline || draft.deadline;
        draft.trackingNotes = trackingNotes || draft.trackingNotes;
        
        // Final section updates
        if (isFinal !== undefined) draft.isFinal = isFinal;
        if (version) draft.version = version;
        
        if (status === 'Approved' && draft.status !== 'Approved') {
            draft.approvedBy = req.user ? req.user.name : 'Admin';
            draft.approvalDate = Date.now();
        } else if (approvedBy) {
            draft.approvedBy = approvedBy;
        }

        await draft.save();
        res.status(200).json({ success: true, data: draft });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Delete Document
exports.deleteDraft = async (req, res) => {
    try {
        const draft = await DraftingWork.findById(req.params.id);
        if (!draft) {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }

        if (fs.existsSync(draft.documentPath)) {
            fs.unlinkSync(draft.documentPath);
        }

        await draft.deleteOne();
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Serve File
exports.serveFile = (req, res) => {
    const filename = req.params.filename;
    // Need to find the actual documentPath
    DraftingWork.findOne({ documentUrl: { $regex: filename } }).then(draft => {
        if (!draft || !fs.existsSync(draft.documentPath)) {
            return res.status(404).send('File not found');
        }
        res.sendFile(path.resolve(draft.documentPath));
    }).catch(err => {
        res.status(500).send('Server Error');
    });
};
