const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getAllDrafts, uploadDraft, updateDraft, deleteDraft, serveFile } = require('../controllers/draftingWorkController');

// Dynamic Storage Configuration for Drafting
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS === 'true';
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        let targetDir;
        if (useNas) {
            targetDir = path.join(nasBase, 'drafting_work');
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'drafting_work');
        }

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'draft-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for CAD/DWG/PDF files
    fileFilter: (req, file, cb) => {
        // Allow all drawing/drafting formats: dwg, dxf, pdf, jpeg, jpg, png, doc, docx, xls, xlsx
        cb(null, true); 
    }
});

// Routes
router.get('/', getAllDrafts);
router.post('/upload', upload.single('document'), uploadDraft);
router.put('/:id', updateDraft);
router.delete('/:id', deleteDraft);
router.get('/file/:filename', serveFile);

module.exports = router;
