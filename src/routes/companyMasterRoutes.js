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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedExts = /pdf|jpeg|jpg|png|webp|svg/;
        const extname = allowedExts.test(path.extname(file.originalname).toLowerCase());
        const mimetype = /pdf|image/.test(file.mimetype);
        if (extname || mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only PDF documents and image files are allowed'));
    }
});

const companyUploadFields = upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'udyamDoc', maxCount: 1 },
    { name: 'panCardDoc', maxCount: 1 },
    { name: 'gstDoc', maxCount: 1 },
    { name: 'cancelledChequeDoc', maxCount: 1 },
    { name: 'companyStamp', maxCount: 1 }
]);

router.post('/', companyUploadFields, storeCompany);
router.put('/:id', companyUploadFields, updateCompany);
router.get('/', getCompanies);
router.delete('/:id', deleteCompany);

module.exports = router;
