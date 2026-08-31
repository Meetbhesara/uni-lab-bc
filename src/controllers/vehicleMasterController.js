const VehicleMaster = require('../models/VehicleMaster');
const path = require('path');
const { broadcast } = require('../utils/sseManager');

const storeVehicleMaster = async (req, res) => {
    try {
        const { vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName, primaryPhotoName, primaryType } = req.body;
        const files = req.files;

        let rcBookData = null;
        let insurancePhotoData = null;
        let pucPhotoData = null;
        let vehiclePhotos = [];
        const documents = [];

        // Distinguish specific files and generic documents
        const folderName = (vehicleNumber || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        if (files) {
            if (files.rcBook) {
                const f = Array.isArray(files.rcBook) ? files.rcBook[0] : files.rcBook;
                rcBookData = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.insurancePhoto) {
                const f = Array.isArray(files.insurancePhoto) ? files.insurancePhoto[0] : files.insurancePhoto;
                insurancePhotoData = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.pucPhoto) {
                const f = Array.isArray(files.pucPhoto) ? files.pucPhoto[0] : files.pucPhoto;
                pucPhotoData = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.vehiclePhotos) {
                const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
                flist.forEach(f => vehiclePhotos.push({ name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path }));
            }
            if (files.documents) {
                const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
                flist.forEach(f => documents.push({ name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path }));
            }
        }

        // If a specific newly uploaded photo is marked as primary, put it at index 0
        if (primaryPhotoName && vehiclePhotos.length > 1) {
            const pIdx = vehiclePhotos.findIndex(p => p.name === primaryPhotoName);
            if (pIdx > 0) {
                const pItem = vehiclePhotos[pIdx];
                vehiclePhotos = [pItem, ...vehiclePhotos.filter((_, idx) => idx !== pIdx)];
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
        broadcast('vehicle-changed', { action: 'created' });
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
        const { vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName, existingVehiclePhotos, primaryPhotoUrl, primaryPhotoName, primaryType } = req.body;
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

        const folderName = (record.vehicleNumber || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        if (files) {
            if (files.rcBook) {
                const f = Array.isArray(files.rcBook) ? files.rcBook[0] : files.rcBook;
                record.rcBook = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.insurancePhoto) {
                const f = Array.isArray(files.insurancePhoto) ? files.insurancePhoto[0] : files.insurancePhoto;
                record.insurancePhoto = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.pucPhoto) {
                const f = Array.isArray(files.pucPhoto) ? files.pucPhoto[0] : files.pucPhoto;
                record.pucPhoto = { name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path };
            }
            if (files.documents) {
                const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
                flist.forEach(f => record.documents.push({ name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path }));
            }
        }

        // 1. Process and reorder existing vehicle photos
        let parsedExisting = [];
        if (existingVehiclePhotos) {
            if (typeof existingVehiclePhotos === 'string') {
                try {
                    parsedExisting = JSON.parse(existingVehiclePhotos);
                } catch (e) {
                    parsedExisting = [existingVehiclePhotos];
                }
            } else if (Array.isArray(existingVehiclePhotos)) {
                parsedExisting = existingVehiclePhotos;
            }
        }

        // Map existing URLs to their existing photo objects
        let updatedExistingList = [];
        if (Array.isArray(record.vehiclePhotos)) {
            if (parsedExisting.length > 0) {
                // Keep photos that are still in parsedExisting, in the exact order received from client
                parsedExisting.forEach(url => {
                    const found = record.vehiclePhotos.find(p => p.url === url || (p.url && p.url.endsWith(url)));
                    if (found) {
                        updatedExistingList.push(found);
                    } else {
                        updatedExistingList.push({ name: path.basename(url), url: url });
                    }
                });
            } else if (req.body.existingVehiclePhotos !== undefined) {
                // Client explicitly sent an empty existing photos list -> clear existing photos
                updatedExistingList = [];
            } else {
                // Retain current photos if field was omitted
                updatedExistingList = record.vehiclePhotos;
            }
        }

        // 2. Process newly uploaded photos
        let newUploadedList = [];
        if (files && files.vehiclePhotos) {
            const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
            flist.forEach(f => newUploadedList.push({ name: f.originalname, url: `/uploads/vehicle_master/${folderName}/${path.basename(f.path)}`, path: f.path }));
        }

        // 3. Reorder with primary photo at index 0
        let finalVehiclePhotos = [];
        if (primaryType === 'new' || (primaryPhotoName && newUploadedList.some(p => p.name === primaryPhotoName))) {
            // New photo is primary
            if (primaryPhotoName) {
                const pIdx = newUploadedList.findIndex(p => p.name === primaryPhotoName);
                if (pIdx > 0) {
                    const pItem = newUploadedList[pIdx];
                    newUploadedList = [pItem, ...newUploadedList.filter((_, idx) => idx !== pIdx)];
                }
            }
            finalVehiclePhotos = [...newUploadedList, ...updatedExistingList];
        } else {
            // Existing photo is primary (or default)
            if (primaryPhotoUrl && updatedExistingList.length > 0) {
                const pIdx = updatedExistingList.findIndex(p => p.url === primaryPhotoUrl || (p.url && p.url.endsWith(primaryPhotoUrl)));
                if (pIdx > 0) {
                    const pItem = updatedExistingList[pIdx];
                    updatedExistingList = [pItem, ...updatedExistingList.filter((_, idx) => idx !== pIdx)];
                }
            }
            finalVehiclePhotos = [...updatedExistingList, ...newUploadedList];
        }

        record.vehiclePhotos = finalVehiclePhotos;

        await record.save();
        broadcast('vehicle-changed', { action: 'updated' });
        res.json({ success: true, message: 'Updated successfully', data: record });
    } catch (error) {
        console.error('Error in updateVehicleMaster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteVehicleMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const record = await VehicleMaster.findByIdAndDelete(_id);
        if (!record) return res.status(404).json({ success: false, message: 'Vehicle not found' });
        broadcast('vehicle-changed', { action: 'deleted' });
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
