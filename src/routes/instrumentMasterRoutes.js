const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
    storeInstrumentMaster,
    getInstruments,
    getInstrumentById,
    updateInstrumentMaster,
    deleteInstrumentMaster
} = require('../controllers/instrumentMasterController');

// Dynamic Storage Configuration (NAS / Local)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        let targetDir;
        if (useNas) {
            targetDir = path.join(nasBase, 'myapp', 'instrument_master');
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase)
                ? localBase
                : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'instrument_master');
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only images and PDFs are allowed'));
    }
});

router.post('/',   upload.fields([{ name: 'photo', maxCount: 1 }]), storeInstrumentMaster);
router.get('/',    getInstruments);
router.get('/:id', getInstrumentById);
router.put('/:id', upload.fields([{ name: 'photo', maxCount: 1 }]), updateInstrumentMaster);
router.delete('/:id', deleteInstrumentMaster);

module.exports = router;
