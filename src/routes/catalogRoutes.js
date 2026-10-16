const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middlewares/auth');
const { getCatalogs, createCatalog, deleteCatalog } = require('../controllers/catalogController');

const uploadDir = path.join(__dirname, '../../uploads/catalogs');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `catalog-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = (file.mimetype || '').toLowerCase();
        if (
            allowed.includes(ext) ||
            mime.includes('pdf') ||
            mime.includes('image/') ||
            mime.includes('msword')
        ) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, JPG, JPEG, PNG, and document files are allowed for catalogs'));
        }
    }
});

router.get('/', getCatalogs);
router.post('/', auth, upload.single('pdf'), createCatalog);
router.delete('/:id', auth, deleteCatalog);

module.exports = router;
