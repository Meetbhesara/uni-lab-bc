const VehicleMaster = require('../models/VehicleMaster');
const path = require('path');

const storeVehicleMaster = async (req, res) => {
    try {
        const { vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName } = req.body;
        const files = req.files;

        let rcBookData = null;
        let insurancePhotoData = null;
        let pucPhotoData = null;
        const documents = [];

        // Distinguish specific files and generic documents
        if (files) {
            if (files.rcBook) {
                const f = Array.isArray(files.rcBook) ? files.rcBook[0] : files.rcBook;
                rcBookData = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.insurancePhoto) {
                const f = Array.isArray(files.insurancePhoto) ? files.insurancePhoto[0] : files.insurancePhoto;
                insurancePhotoData = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.pucPhoto) {
                const f = Array.isArray(files.pucPhoto) ? files.pucPhoto[0] : files.pucPhoto;
                pucPhotoData = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.documents) {
                const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
                flist.forEach(f => documents.push({ name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path }));
            }
        }

        const record = new VehicleMaster({ 
            vehicleNumber, 
            vehicleName, 
            insuranceDate, 
            pucDate, 
            serviceDate, 
            logInName, 
            rcBook: rcBookData,
            insurancePhoto: insurancePhotoData,
            pucPhoto: pucPhotoData,
            documents 
        });
        await record.save();
        res.status(201).json({ success: true, message: 'Saved successfully', data: record });
    } catch (error) {
        console.error('Error in storeVehicleMaster:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during storage',
            error: error.message
        });
    }
};

const getVehicles = async (req, res) => {
    try {
        const vehicles = await VehicleMaster.find().sort({ createdAt: -1 });
        res.json({ success: true, data: vehicles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeVehicleMaster,
    getVehicles
};
