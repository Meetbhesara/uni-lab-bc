const InstrumentMaster = require('../models/InstrumentMaster');
const path = require('path');

const storeInstrumentMaster = async (req, res) => {
    try {

        const { model, serialNo, instrumentName, notes } = req.body;
        const files = req.files;

        if (!serialNo) {
            return res.status(400).json({ success: false, message: 'Serial number is required' });
        }

        const subfolder = `${serialNo || 'no_serial'}-${model || 'no_model'}`.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        let photoData = null;
        if (files && files.photo) {
            const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            photoData = {
                name: f.originalname,
                url: `/uploads/instrument_master/${subfolder}/${path.basename(f.path)}`,
                path: f.path
            };
        }

        let photosData = [];
        if (files && files.photos) {
            const flist = Array.isArray(files.photos) ? files.photos : [files.photos];
            photosData = flist.map(f => ({
                name: f.originalname,
                url: `/uploads/instrument_master/${subfolder}/${path.basename(f.path)}`,
                path: f.path
            }));
        }

        const record = new InstrumentMaster({
            model: model ? model.trim() : null,
            serialNo: serialNo.trim(),
            instrumentName: instrumentName ? instrumentName.trim() : null,
            photo: photoData,
            photos: photosData,
            notes: notes ? notes.trim() : null
        });

        await record.save();
        res.status(201).json({
            success: true,
            message: 'Instrument record saved successfully',
            data: record
        });
    } catch (error) {
        console.error('Error in storeInstrumentMaster:', error);
        // Handle duplicate refNo
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
        const { model, serialNo, instrumentName, notes } = req.body;
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

        // Determine subfolder for URL (use provided or fallback to existing)
        const finalSerial = serialNo !== undefined ? serialNo : record.serialNo;
        const finalModel = model !== undefined ? model : record.model;
        const subfolder = `${finalSerial || 'no_serial'}-${finalModel || 'no_model'}`.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        if (files) {
            if (files.photo) {
                const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
                updateData.photo = {
                    name: f.originalname,
                    url: `/uploads/instrument_master/${subfolder}/${path.basename(f.path)}`,
                    path: f.path
                };
            }
            if (files.photos) {
                const flist = Array.isArray(files.photos) ? files.photos : [files.photos];
                const photos = flist.map(f => ({
                    name: f.originalname,
                    url: `/uploads/instrument_master/${subfolder}/${path.basename(f.path)}`,
                    path: f.path
                }));
                updateData.photos = photos;
            }
        }

        const updatedRecord = await InstrumentMaster.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: 'Instrument updated successfully', data: updatedRecord });
    } catch (error) {
        console.error('Error in updateInstrumentMaster:', error);
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `Reference number '${req.body.refNo}' already exists`
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
        res.json({ success: true, message: 'Instrument deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeInstrumentMaster,
    getInstruments,
    getInstrumentById,
    updateInstrumentMaster,
    deleteInstrumentMaster
};
