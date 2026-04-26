const EmployeeMaster = require('../models/EmployeeMaster');

const Counter = require('../models/Counter');
const path = require('path');
const fs = require('fs');

const storeEmployeeMaster = async (req, res) => {
    try {
        console.log('Incoming Employee Master data:', req.body);
        console.log('Incoming Employee Master files:', req.files);
        const { 
            name, 
            email, 
            phone,
            addressLine1, 
            addressLine2, 
            emergencyContact,
            bankDetails,
            salary,
            designation
        } = req.body;
        const files = req.files;

        // Parse JSON strings from multipart form data
        const parse = (val) => {
            try { return typeof val === 'string' ? JSON.parse(val) : val; }
            catch (e) { return val; }
        };

        // Autogenerate EMP ID
        const counter = await Counter.findByIdAndUpdate(
            'employeeId',
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );
        const generatedEmpId = `${String(counter.seq).padStart(4, '0')}`;

        // Folder naming: name-empId
        const namePart = (name || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const idPart = generatedEmpId.toLowerCase();
        const folderName = `${namePart}-${idPart}`;

        // If folder created by multer (using req.body.empId) is different, rename it
        const reqEmpId = (req.body.empId || '').toLowerCase();
        if (reqEmpId && reqEmpId !== idPart) {
            const useNas = process.env.USE_NAS === 'true';
            const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';
            
            const tempFolderName = `${namePart}-${reqEmpId}`;
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            const oldDir = path.join(absoluteLocalBase, 'employee_master', tempFolderName);
            const newDir = path.join(absoluteLocalBase, 'employee_master', folderName);
            if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);

            if (useNas) {
                const oldNas = path.join(nasBase, 'myapp', 'employee_master', tempFolderName);
                const newNas = path.join(nasBase, 'myapp', 'employee_master', folderName);
                if (fs.existsSync(oldNas)) fs.renameSync(oldNas, newNas);
            }
        }

        const fileToObj = (file) => {
            if (!file) return null;
            const f = Array.isArray(file) ? file[0] : file;
            return { 
                name: f.originalname, 
                url: `/uploads/employee_master/${folderName}/${path.basename(f.path)}`, 
                path: f.path.replace(`-${reqEmpId}`, `-${idPart}`) // adjust path if renamed
            };
        };

        const parsedBankDetails = parse(bankDetails) || {};

        const record = new EmployeeMaster({ 
            empId: generatedEmpId,
            name, 
            salary: Number(salary) || 0,
            designation,
            email, 
            phone,
            addressLine1: parse(addressLine1), 
            addressLine2: parse(addressLine2), 
            emergencyContact: parse(emergencyContact),
            bankDetails: {
                bankName: parsedBankDetails.bankName || '',
                accountName: parsedBankDetails.accountName || '',
                accountNumber: parsedBankDetails.accountNumber || '',
                ifscCode: parsedBankDetails.ifscCode || '',
            },
            photo: fileToObj(files?.photo),
            aadharCard: fileToObj(files?.aadharCard),
            panCard: fileToObj(files?.panCard),
            voterId: fileToObj(files?.voterId),
            drivingLicense: fileToObj(files?.drivingLicense)
        });

        await record.save();
        res.status(201).json({ 
            success: true, 
            message: 'Employee record stored successfully', 
            data: record 
        });
    } catch (error) {
        console.error('Error in storeEmployeeMaster:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during storage',
            error: error.message
        });
    }
};

const updateEmployeeMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const oldRecord = await EmployeeMaster.findById(_id);
        if (!oldRecord) return res.status(404).json({ success: false, message: 'Employee not found' });

        const { 
            name, email, phone, addressLine1, addressLine2, emergencyContact, bankDetails, salary, designation
        } = req.body;
        const files = req.files;

        const parse = (val) => {
            try { return typeof val === 'string' ? JSON.parse(val) : val; }
            catch (e) { return val; }
        };

        const oldNamePart = oldRecord.name.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const oldIdPart = oldRecord.empId.toLowerCase();
        const oldFolderName = `${oldNamePart}-${oldIdPart}`;

        const newNamePart = (name || oldRecord.name).trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const newFolderName = `${newNamePart}-${oldIdPart}`;

        // 1. Check if name changed -> rename directory if applicable
        if (oldFolderName !== newFolderName) {
            const useNas = process.env.USE_NAS === 'true';
            const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';

            // Local folder logic
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            const oldLocalDir = path.join(absoluteLocalBase, 'employee_master', oldFolderName);
            const newLocalDir = path.join(absoluteLocalBase, 'employee_master', newFolderName);

            if (fs.existsSync(oldLocalDir)) {
                if (fs.existsSync(newLocalDir)) {
                    // move files
                    fs.readdirSync(oldLocalDir).forEach(file => {
                        const src = path.join(oldLocalDir, file);
                        const dest = path.join(newLocalDir, file);
                        if (!fs.existsSync(dest)) fs.renameSync(src, dest);
                    });
                    fs.rmSync(oldLocalDir, { recursive: true, force: true });
                } else {
                    fs.renameSync(oldLocalDir, newLocalDir);
                }
            }

            // NAS folder logic
            if (useNas) {
                const oldNasDir = path.join(nasBase, 'myapp', 'employee_master', oldFolderName);
                const newNasDir = path.join(nasBase, 'myapp', 'employee_master', newFolderName);
                if (fs.existsSync(oldNasDir)) {
                    if (fs.existsSync(newNasDir)) {
                        fs.readdirSync(oldNasDir).forEach(file => {
                            const src = path.join(oldNasDir, file);
                            const dest = path.join(newNasDir, file);
                            if (!fs.existsSync(dest)) fs.renameSync(src, dest);
                        });
                        fs.rmSync(oldNasDir, { recursive: true, force: true });
                    } else {
                        fs.renameSync(oldNasDir, newNasDir);
                    }
                }
            }
        }

        const fileToObj = (file) => {
            if (!file) return null;
            const f = Array.isArray(file) ? file[0] : file;
            return { 
                name: f.originalname, 
                url: `/uploads/employee_master/${newFolderName}/${path.basename(f.path)}`, 
                path: f.path 
            };
        };

        const updateUrlPath = (fileObj) => {
            if (!fileObj || !fileObj.url) return null;
            if (oldFolderName !== newFolderName) {
                fileObj.url = fileObj.url.replace(`/employee_master/${oldFolderName}/`, `/employee_master/${newFolderName}/`);
                if (fileObj.path) {
                    fileObj.path = fileObj.path.replace(`${oldFolderName}`, `${newFolderName}`);
                }
            }
            return fileObj;
        };

        const parsedBankDetails = parse(bankDetails) || {};

        oldRecord.name = name;
        oldRecord.salary = Number(salary) || oldRecord.salary;
        oldRecord.designation = designation || oldRecord.designation;
        oldRecord.email = email;
        oldRecord.phone = phone;
        oldRecord.addressLine1 = parse(addressLine1);
        oldRecord.addressLine2 = parse(addressLine2);
        oldRecord.emergencyContact = parse(emergencyContact);
        oldRecord.bankDetails = {
            bankName: parsedBankDetails.bankName || '',
            accountName: parsedBankDetails.accountName || '',
            accountNumber: parsedBankDetails.accountNumber || '',
            ifscCode: parsedBankDetails.ifscCode || ''
        };

        if (files?.photo) oldRecord.photo = fileToObj(files.photo);
        else if (oldRecord.photo) oldRecord.photo = updateUrlPath(oldRecord.photo);

        if (files?.aadharCard) oldRecord.aadharCard = fileToObj(files.aadharCard);
        else if (oldRecord.aadharCard) oldRecord.aadharCard = updateUrlPath(oldRecord.aadharCard);

        if (files?.panCard) oldRecord.panCard = fileToObj(files.panCard);
        else if (oldRecord.panCard) oldRecord.panCard = updateUrlPath(oldRecord.panCard);

        if (files?.voterId) oldRecord.voterId = fileToObj(files.voterId);
        else if (oldRecord.voterId) oldRecord.voterId = updateUrlPath(oldRecord.voterId);

        if (files?.drivingLicense) oldRecord.drivingLicense = fileToObj(files.drivingLicense);
        else if (oldRecord.drivingLicense) oldRecord.drivingLicense = updateUrlPath(oldRecord.drivingLicense);

        await oldRecord.save();

        res.json({ success: true, message: 'Employee updated successfully', data: oldRecord });
    } catch (error) {
        console.error('Error in updateEmployeeMaster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getEmployees = async (req, res) => {
    try {
        const employees = await EmployeeMaster.find().sort({ createdAt: -1 });
        res.json({ success: true, data: employees });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextEmpId = async (req, res) => {
    try {
        let counter = await Counter.findById('employeeId');
        let nextSeq = counter ? counter.seq + 1 : 1;
        const nextEmpId = `${String(nextSeq).padStart(4, '0')}`;
        res.json({ success: true, nextEmpId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeEmployeeMaster,
    updateEmployeeMaster,
    getEmployees,
    getNextEmpId
};
