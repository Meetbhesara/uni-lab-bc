const fs = require('fs');
const path = require('path');
const Catalog = require('../models/Catalog');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/catalogs');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Format file size nicely
const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// GET all catalogs
const getCatalogs = async (req, res) => {
    try {
        const { search, category } = req.query;
        let query = {};
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }
        if (category && category !== 'All') {
            query.category = category;
        }

        const catalogs = await Catalog.find(query).sort({ createdAt: -1 });
        res.json({ success: true, count: catalogs.length, data: catalogs });
    } catch (err) {
        console.error('Error fetching catalogs:', err);
        res.status(500).json({ success: false, message: 'Server error fetching catalogs' });
    }
};

// CREATE new catalog
const createCatalog = async (req, res) => {
    try {
        const { title, description, category } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, message: 'Catalog title is required' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a catalog PDF file' });
        }

        const pdfUrl = `/uploads/catalogs/${req.file.filename}`;
        const fileSize = formatBytes(req.file.size);

        const catalog = new Catalog({
            title: title.trim(),
            description: (description || '').trim(),
            category: (category || 'General').trim(),
            pdfUrl,
            fileName: req.file.originalname,
            fileSize,
            uploadedBy: req.user?.id || null
        });

        await catalog.save();
        res.status(201).json({
            success: true,
            msg: 'Catalog uploaded successfully',
            data: catalog
        });
    } catch (err) {
        console.error('Error creating catalog:', err);
        res.status(500).json({ success: false, message: err.message || 'Server error creating catalog' });
    }
};

// DELETE catalog
const deleteCatalog = async (req, res) => {
    try {
        const { id } = req.params;
        const catalog = await Catalog.findById(id);
        if (!catalog) {
            return res.status(404).json({ success: false, message: 'Catalog not found' });
        }

        // Try deleting the physical file from disk
        try {
            if (catalog.pdfUrl) {
                const fileName = path.basename(catalog.pdfUrl);
                const filePath = path.join(uploadDir, fileName);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (fileErr) {
            console.warn('Could not delete physical catalog file:', fileErr.message);
        }

        await Catalog.findByIdAndDelete(id);
        res.json({ success: true, msg: 'Catalog deleted successfully' });
    } catch (err) {
        console.error('Error deleting catalog:', err);
        res.status(500).json({ success: false, message: 'Server error deleting catalog' });
    }
};

module.exports = {
    getCatalogs,
    createCatalog,
    deleteCatalog
};
