const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { storeEmployeeMaster, updateEmployeeMaster, getEmployees, getNextEmpId, deleteEmployeeMaster } = require('../controllers/employeeMasterController');

// Dynamic Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const useNas = process.env.USE_NAS;
        const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';

        const namePart = (req.body.name || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const idPart = (req.body.empId || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const folderName = idPart;

        let targetDir;
        if (useNas === 'true') {
            targetDir = path.join(nasBase, 'myapp', 'employee_master', folderName);
        } else {
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            targetDir = path.join(absoluteLocalBase, 'employee_master', folderName);
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

router.get('/next-id', getNextEmpId);

router.post('/', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'aadharCard', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'voterId', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 }
]), storeEmployeeMaster);

router.put('/:id', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'aadharCard', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'voterId', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 }
]), updateEmployeeMaster);

router.get('/', getEmployees);
router.delete('/:id', deleteEmployeeMaster);

module.exports = router;
