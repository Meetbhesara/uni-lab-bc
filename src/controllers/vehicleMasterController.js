const VehicleMaster = require('../models/VehicleMaster');
const path = require('path');

const storeVehicleMaster = async (req, res) => {
    try {
        const { vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName } = req.body;
        const files = req.files;

        let rcBookData = null;
        let insurancePhotoData = null;
        let pucPhotoData = null;
        const vehiclePhotos = [];
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
            if (files.vehiclePhotos) {
                const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
                flist.forEach(f => vehiclePhotos.push({ name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path }));
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
            vehiclePhotos,
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

const updateVehicleMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const { vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName } = req.body;
        const files = req.files;

        const record = await VehicleMaster.findById(_id);
        if (!record) return res.status(404).json({ success: false, message: 'Vehicle not found' });

        // Update basic fields, allow clearing name
        if (vehicleNumber !== undefined) record.vehicleNumber = vehicleNumber;
        if (vehicleName !== undefined) record.vehicleName = vehicleName;
        if (insuranceDate !== undefined) record.insuranceDate = insuranceDate;
        if (pucDate !== undefined) record.pucDate = pucDate;
        if (serviceDate !== undefined) record.serviceDate = serviceDate;
        if (logInName !== undefined) record.logInName = logInName;

        if (files) {
            if (files.rcBook) {
                const f = Array.isArray(files.rcBook) ? files.rcBook[0] : files.rcBook;
                record.rcBook = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.insurancePhoto) {
                const f = Array.isArray(files.insurancePhoto) ? files.insurancePhoto[0] : files.insurancePhoto;
                record.insurancePhoto = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.pucPhoto) {
                const f = Array.isArray(files.pucPhoto) ? files.pucPhoto[0] : files.pucPhoto;
                record.pucPhoto = { name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path };
            }
            if (files.vehiclePhotos) {
                const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
                flist.forEach(f => record.vehiclePhotos.push({ name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path }));
            }
            if (files.documents) {
                const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
                flist.forEach(f => record.documents.push({ name: f.originalname, url: `/uploads/vehicle_master/${path.basename(f.path)}`, path: f.path }));
            }
        }

        await record.save();
        res.json({ success: true, message: 'Updated successfully', data: record });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteVehicleMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const record = await VehicleMaster.findByIdAndDelete(_id);
        if (!record) return res.status(404).json({ success: false, message: 'Vehicle not found' });
        
        // Logical deletion of files could be added here if needed
        
        res.json({ success: true, message: 'Vehicle deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeVehicleMaster,
    getVehicles,
    updateVehicleMaster,
    deleteVehicleMaster
};
