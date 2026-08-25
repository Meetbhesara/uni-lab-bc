const InstrumentMaster = require('../models/InstrumentMaster');
const InstrumentGroup = require('../models/InstrumentGroup');
const path = require('path');
const { broadcast } = require('../utils/sseManager');

// Helper to compute /uploads/instrument_master/... relative URL from disk file path
const computePhotoUrl = (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.indexOf('/instrument_master/');
    if (idx !== -1) {
        return `/uploads${normalized.substring(idx)}`;
    }
    return `/uploads/instrument_master/${path.basename(filePath)}`;
};

const storeInstrumentMaster = async (req, res) => {
    try {
        const { model, serialNo, instrumentName, notes, parentInstrumentId, primaryPhotoName, primaryPhotoUrl } = req.body;
        const files = req.files;

        if (!serialNo) {
            return res.status(400).json({ success: false, message: 'Serial number is required' });
        }

        let photoData = null;
        if (files && files.photo) {
            const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            photoData = {
                name: f.originalname,
                url: computePhotoUrl(f.path),
                path: f.path
            };
        }

        let photosData = [];
        if (files && files.photos) {
            const flist = Array.isArray(files.photos) ? files.photos : [files.photos];
            photosData = flist.map(f => ({
                name: f.originalname,
                url: computePhotoUrl(f.path),
                path: f.path
            }));
        }

        // Set primary photo
        if (primaryPhotoUrl) {
            const match = photosData.find(p => p.url === primaryPhotoUrl);
            if (match) photoData = match;
        } else if (primaryPhotoName) {
            const match = photosData.find(p => p.name === primaryPhotoName);
            if (match) photoData = match;
        }
        
        if (!photoData && photosData.length > 0) {
            photoData = photosData[0];
        }

        const record = new InstrumentMaster({
            model: model ? model.trim() : null,
            serialNo: serialNo.trim(),
            instrumentName: instrumentName ? instrumentName.trim() : null,
            parentInstrumentId: parentInstrumentId || null,
            photo: photoData,
            photos: photosData,
            notes: notes ? notes.trim() : null
        });

        await record.save();
        broadcast('instrument-changed', { action: 'created' });
        res.status(201).json({
            success: true,
            message: 'Instrument record saved successfully',
            data: record
        });
    } catch (error) {
        console.error('Error in storeInstrumentMaster:', error);
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Serial number '${req.body.serialNo}' already exists`
            });
        }
        res.status(500).json({
            success: false,
            message: 'Internal server error during storage',
            error: error.message
        });
    }
};

const getInstruments = async (req, res) => {
    try {
        const instruments = await InstrumentMaster.find().sort({ createdAt: -1 });
        res.json({ success: true, data: instruments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getInstrumentById = async (req, res) => {
    try {
        const instrument = await InstrumentMaster.findById(req.params.id);
        if (!instrument) {
            return res.status(404).json({ success: false, message: 'Instrument not found' });
        }
        res.json({ success: true, data: instrument });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateInstrumentMaster = async (req, res) => {
    try {
        const { model, serialNo, instrumentName, notes, parentInstrumentId, existingPhotos, primaryPhotoUrl, primaryPhotoName } = req.body;
        const files = req.files;

        const record = await InstrumentMaster.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Instrument not found' });
        }

        const updateData = {};
        if (model !== undefined) updateData.model = model ? model.trim() : null;
        if (serialNo !== undefined) updateData.serialNo = serialNo.trim();
        if (instrumentName !== undefined) updateData.instrumentName = instrumentName ? instrumentName.trim() : null;
        if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;
        if (parentInstrumentId !== undefined) updateData.parentInstrumentId = parentInstrumentId ? parentInstrumentId : null;

        let finalPhotos = [];
        
        // 1. Process existing photos
        if (existingPhotos) {
            const eList = Array.isArray(existingPhotos) ? existingPhotos : [existingPhotos];
            const currentPhotos = record.photos || [];
            eList.forEach(url => {
                const match = currentPhotos.find(p => p.url === url);
                if (match) finalPhotos.push(match);
                else if (record.photo && record.photo.url === url) finalPhotos.push(record.photo);
            });
        }

        // 2. Process new photos
        if (files) {
            if (files.photo) {
                const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
                updateData.photo = {
                    name: f.originalname,
                    url: computePhotoUrl(f.path),
                    path: f.path
                };
            }
            if (files.photos) {
                const flist = Array.isArray(files.photos) ? files.photos : [files.photos];
                const newPhotosData = flist.map(f => ({
                    name: f.originalname,
                    url: computePhotoUrl(f.path),
                    path: f.path
                }));
                finalPhotos = finalPhotos.concat(newPhotosData);
            }
        }

        updateData.photos = finalPhotos;

        // 3. Set Primary Photo
        if (primaryPhotoUrl) {
            const match = finalPhotos.find(p => p.url === primaryPhotoUrl);
            if (match) updateData.photo = match;
        } else if (primaryPhotoName) {
            const match = finalPhotos.find(p => p.name === primaryPhotoName);
            if (match) updateData.photo = match;
        } else if (finalPhotos.length > 0) {
            updateData.photo = finalPhotos[0];
        } else {
            updateData.photo = null;
        }

        const updatedRecord = await InstrumentMaster.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        broadcast('instrument-changed', { action: 'updated' });
        res.json({ success: true, message: 'Instrument updated successfully', data: updatedRecord });
    } catch (error) {
        console.error('Error in updateInstrumentMaster:', error);
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Serial number '${req.body.serialNo}' already exists`
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteInstrumentMaster = async (req, res) => {
    try {
        const record = await InstrumentMaster.findByIdAndDelete(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Instrument not found' });
        }
        
        // nullify children's parent references
        await InstrumentMaster.updateMany({ parentInstrumentId: req.params.id }, { $set: { parentInstrumentId: null } });

        broadcast('instrument-changed', { action: 'deleted' });
        res.json({ success: true, message: 'Instrument deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getGroups = async (req, res) => {
    try {
        const groups = await InstrumentGroup.find().populate('instruments').sort({ createdAt: -1 });
        res.json({ success: true, data: groups });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextGroupId = async (req, res) => {
    try {
        const lastGroup = await InstrumentGroup.findOne({}, { groupId: 1 }).sort({ groupId: -1 });
        let nextSeq = 1;
        if (lastGroup && lastGroup.groupId) {
            const num = parseInt(lastGroup.groupId.replace('GRP-', ''));
            if (!isNaN(num)) nextSeq = num + 1;
        }
        const nextGroupId = 'GRP-' + String(nextSeq).padStart(3, '0');
        res.json({ success: true, nextGroupId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createGroup = async (req, res) => {
    try {
        const { name, instruments } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Group name is required' });
        }

        if (instruments && instruments.length > 0) {
            const existing = await InstrumentGroup.findOne({ instruments: { $in: instruments } });
            if (existing) {
                return res.status(400).json({ success: false, message: 'One or more instruments are already assigned to another group.' });
            }
        }

        const lastGroup = await InstrumentGroup.findOne({}, { groupId: 1 }).sort({ groupId: -1 });
        let nextSeq = 1;
        if (lastGroup && lastGroup.groupId) {
            const num = parseInt(lastGroup.groupId.replace('GRP-', ''));
            if (!isNaN(num)) nextSeq = num + 1;
        }
        const groupId = 'GRP-' + String(nextSeq).padStart(3, '0');

        const group = new InstrumentGroup({ groupId, name, instruments: instruments || [] });
        await group.save();
        res.status(201).json({ success: true, message: 'Group created successfully', data: group });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateGroup = async (req, res) => {
    try {
        const { name, instruments } = req.body;
        const group = await InstrumentGroup.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }
        
        if (instruments && instruments.length > 0) {
            const existing = await InstrumentGroup.findOne({ _id: { $ne: group._id }, instruments: { $in: instruments } });
            if (existing) {
                return res.status(400).json({ success: false, message: 'One or more instruments are already assigned to another group.' });
            }
        }

        group.name = name || group.name;
        if (instruments !== undefined) group.instruments = instruments;
        
        await group.save();
        res.json({ success: true, message: 'Group updated successfully', data: group });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteGroup = async (req, res) => {
    try {
        const group = await InstrumentGroup.findByIdAndDelete(req.params.id);
        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }
        res.json({ success: true, message: 'Group deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeInstrumentMaster,
    getInstruments,
    getInstrumentById,
    updateInstrumentMaster,
    deleteInstrumentMaster,
    getGroups,
    getNextGroupId,
    createGroup,
    updateGroup,
    deleteGroup
};
