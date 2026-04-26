const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeVehicleMaster, getVehicles } = require('../controllers/vehicleMasterController');

// Dynamic Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Use flag from .env to decide storage mode
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        let targetDir;
        if (useNas) {
            // Append target subfolder to NAS base
            targetDir = path.join(nasBase, 'myapp', 'vehicle_master');
        } else {
            // Append target subfolder to Local base
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'vehicle_master');
        }

        if (!fs.existsSync(targetDir)) {
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
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only images and PDFs are allowed'));
    }
});

// Use .fields to support specific RC Book and generic documents
router.post('/', upload.fields([
    { name: 'rcBook', maxCount: 1 },
    { name: 'insurancePhoto', maxCount: 1 },
    { name: 'pucPhoto', maxCount: 1 },
    { name: 'documents', maxCount: 10 }
]), storeVehicleMaster);
router.get('/', getVehicles);

module.exports = router;
