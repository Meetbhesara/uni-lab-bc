const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/checkPermission');
const InstrumentMaster = require('../models/InstrumentMaster');
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
// Folder naming format: [serialNo]-[instrumentName]
// Child folders are directly inside parent folder: [parent_serial]-[parent_name]/[child_serial]-[child_name]
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const useNas = process.env.USE_NAS;
            let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
            if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';

            const { serialNo, instrumentName, model, parentInstrumentId } = req.body;
            
            const sanitizeFolderName = (sNo, name, mdl) => {
                const part1 = (sNo || 'no_serial').trim();
                const part2 = (name || mdl || 'instrument').trim();
                return `${part1}-${part2}`.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
            };

            const currentFolder = sanitizeFolderName(serialNo, instrumentName, model);

            let parentFolder = null;
            if (parentInstrumentId) {
                try {
                    const parentDoc = await InstrumentMaster.findById(parentInstrumentId);
                    if (parentDoc) {
                        parentFolder = sanitizeFolderName(parentDoc.serialNo, parentDoc.instrumentName, parentDoc.model);
                    }
                } catch (e) {
                    console.error('Error fetching parent for multer destination:', e);
                }
            }

            let baseDir;
            if (useNas === 'true') {
                baseDir = path.join(nasBase, 'instrument_master');
            } else {
                const absoluteLocalBase = path.isAbsolute(localBase)
                    ? localBase
                    : path.join(process.cwd(), localBase);
                baseDir = path.join(absoluteLocalBase, 'instrument_master');
            }

            let targetDir;
            if (parentFolder) {
                // Child folder directly inside parent folder
                targetDir = path.join(baseDir, parentFolder, currentFolder);
            } else {
                // Parent / Standalone unit folder
                targetDir = path.join(baseDir, currentFolder);
            }

            if (!fs.existsSync(targetDir)) {
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
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        cb(null, true);
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
