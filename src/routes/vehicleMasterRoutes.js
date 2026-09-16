const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeVehicleMaster, getVehicles, updateVehicleMaster, deleteVehicleMaster } = require('../controllers/vehicleMasterController');

// ─ Which fields go into which subfolder ─
const PURCHASE_FIELDS = ['purchaseAadharDoc', 'purchasePanDoc'];
const SOLD_FIELDS     = ['sellAadharDoc', 'sellPanDoc'];

const getSubfolder = (fieldname) => {
    if (PURCHASE_FIELDS.includes(fieldname)) return 'purchase';
    if (SOLD_FIELDS.includes(fieldname))     return 'sold';
    return '';   // vehicle photos, RC, insurance, PUC → vehicle root
};

// ─ Dynamic Storage ─
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas   = process.env.USE_NAS;
        let nasBase    = process.env.NAS_BASE_PATH  || '/app/storage';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;

        const vehicleNum = (req.body.vehicleNumber || 'unknown')
            .trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const subfolder = getSubfolder(file.fieldname);

        let baseDir;
        if (useNas === 'true') {
            baseDir = path.join(nasBase, 'vehicle_master', vehicleNum);
        } else {
            const absLocal = path.isAbsolute(localBase)
                ? localBase
                : path.join(process.cwd(), localBase);
            baseDir = path.join(absLocal, 'vehicle_master', vehicleNum);
        }

        const targetDir = subfolder ? path.join(baseDir, subfolder) : baseDir;

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|pdf/;
        const ok = allowed.test(path.extname(file.originalname).toLowerCase())
                && allowed.test(file.mimetype);
        ok ? cb(null, true) : cb(new Error('Only images and PDFs are allowed'));
    }
});

// upload.any() accepts any field name without throwing MulterError: Unexpected field.
// The normalise middleware converts the resulting req.files array back into the
// keyed object format { fieldname: [file, ...] } that the controller expects.
const vehicleUpload = upload.any();

const normaliseFiles = (req, res, next) => {
    if (Array.isArray(req.files)) {
        const obj = {};
        req.files.forEach(f => {
            if (!obj[f.fieldname]) obj[f.fieldname] = [];
            obj[f.fieldname].push(f);
        });
        req.files = obj;
    }
    next();
};

router.post('/',      vehicleUpload, normaliseFiles, storeVehicleMaster);
router.put('/:id',   vehicleUpload, normaliseFiles, updateVehicleMaster);
router.get('/',      getVehicles);
router.delete('/:id', deleteVehicleMaster);

module.exports = router;
