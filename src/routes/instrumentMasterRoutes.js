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
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        let targetDir;
        if (useNas === 'true') {
            targetDir = path.join(nasBase, 'instrument_master');
            console.log('NAS MODE: targetDir is', targetDir);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase)
                ? localBase
                : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'instrument_master');
            console.log('LOCAL MODE: targetDir is', targetDir);
        }

        if (!fs.existsSync(targetDir)) {
            console.log('Creating directory:', targetDir);
            fs.mkdirSync(targetDir, { recursive: true });
        }
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

router.post('/',   upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 10 }]), storeInstrumentMaster);
router.get('/',    getInstruments);
router.get('/:id', getInstrumentById);
router.put('/:id', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 10 }]), updateInstrumentMaster);
router.delete('/:id', deleteInstrumentMaster);

module.exports = router;
