const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeClientMaster, updateClientMaster, getClients, getNextClientId, deleteClientMaster } = require('../controllers/clientMasterController');

// Dynamic Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS;
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        const namePart = (req.body.clientName || 'unknown_client').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const idPart = (req.body.clientId || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const folderName = idPart;

        let targetDir;
        if (useNas === 'true') {
            targetDir = path.join(nasBase, 'client_master', folderName);
            console.log('NAS MODE: targetDir is', targetDir);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'client_master', folderName);
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

router.get('/next-id', getNextClientId);

router.post('/', upload.fields([
    { name: 'gstCert', maxCount: 1 },
    { name: 'msmeCert', maxCount: 1 }
]), storeClientMaster);

router.put('/:id', upload.fields([
    { name: 'gstCert', maxCount: 1 },
    { name: 'msmeCert', maxCount: 1 }
]), updateClientMaster);

router.get('/', getClients);
router.delete('/:id', deleteClientMaster);

module.exports = router;
