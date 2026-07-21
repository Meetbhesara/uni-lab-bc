const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getCompanies, storeCompany, updateCompany, deleteCompany } = require('../controllers/CompanyMasterController');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS;
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (useNas === 'true' && !nasBase.startsWith('/')) nasBase = '/' + nasBase;
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        const companyName = (req.body.companyName || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        let targetDir;
        if (useNas === 'true') {
            targetDir = path.join(nasBase, 'company_master', companyName);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'company_master', companyName);
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
        const allowedTypes = /jpeg|jpg|png|webp|svg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only images are allowed for logo'));
    }
});

router.post('/', upload.fields([{ name: 'logo', maxCount: 1 }]), storeCompany);
router.put('/:id', upload.fields([{ name: 'logo', maxCount: 1 }]), updateCompany);
router.get('/', getCompanies);
router.delete('/:id', deleteCompany);

module.exports = router;
