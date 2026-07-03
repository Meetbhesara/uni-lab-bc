const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');
const {
    storeInstrumentMaster,
    getInstruments,
    getInstrumentById,
    updateInstrumentMaster,
    deleteInstrumentMaster,
    getGroups,
    getNextGroupId,
    createGroup,
    updateGroup,
    deleteGroup
} = require('../controllers/instrumentMasterController');

// Dynamic Storage Configuration (NAS / Local)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const useNas = process.env.USE_NAS;
            let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
            if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';

            const { serialNo, model } = req.body;
            const subfolder = `${serialNo || 'no_serial'}-${model || 'no_model'}`.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

            let targetDir;
            if (useNas === 'true') {
                targetDir = path.join(nasBase, 'instrument_master', subfolder);
                console.log('NAS MODE: targetDir is', targetDir);
            } else {
                const absoluteLocalBase = path.isAbsolute(localBase)
                    ? localBase
                    : path.join(process.cwd(), localBase);
                targetDir = path.join(absoluteLocalBase, 'instrument_master', subfolder);
                console.log('LOCAL MODE: targetDir is', targetDir);
            }

            if (!fs.existsSync(targetDir)) {
                console.log('Creating directory:', targetDir);
                fs.mkdirSync(targetDir, { recursive: true });
            }
            cb(null, targetDir);
        } catch (err) {
            console.error('Error in Multer destination configuration:', err);
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // Increased to 100MB to support high-res photos and documents
    fileFilter: (req, file, cb) => {
        cb(null, true); // Support all file types (images, PDFs, CAD drawings, spreadsheets, etc.) without restriction
    }
});

// Group routes
router.get('/groups/next-id', auth, checkPermission('instrumentMaster_groups', 'read'), getNextGroupId);
router.get('/groups', auth, checkPermission('instrumentMaster_groups', 'read'), getGroups);
router.post('/groups', auth, checkPermission('instrumentMaster_groups', 'write'), createGroup);
router.put('/groups/:id', auth, checkPermission('instrumentMaster_groups', 'write'), updateGroup);
router.delete('/groups/:id', auth, checkPermission('instrumentMaster_groups', 'write'), deleteGroup);

router.post('/',   auth, checkPermission('instrumentMaster_form', 'write'), upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 10 }]), storeInstrumentMaster);
router.get('/',    auth, checkPermission('instrumentMaster_view', 'read'), getInstruments);
router.get('/:id', auth, checkPermission('instrumentMaster_view', 'read'), getInstrumentById);
router.put('/:id', auth, checkPermission('instrumentMaster_form', 'write'), upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photos', maxCount: 10 }]), updateInstrumentMaster);
router.delete('/:id', auth, checkPermission('instrumentMaster_view', 'write'), deleteInstrumentMaster);

module.exports = router;
