const InstrumentMaster = require('../models/InstrumentMaster');
const path = require('path');

const storeInstrumentMaster = async (req, res) => {
    try {

        const { refNo, instrumentName, notes } = req.body;
        const files = req.files;

        if (!refNo) {
            return res.status(400).json({ success: false, message: 'Reference number is required' });
        }
        if (!instrumentName) {
            return res.status(400).json({ success: false, message: 'Instrument name is required' });
        }

        let photoData = null;
        if (files && files.photo) {
            const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            photoData = {
                name: f.originalname,
                url: `/uploads/instrument_master/${path.basename(f.path)}`,
                path: f.path
            };
        }

        const record = new InstrumentMaster({
            refNo: refNo.trim(),
            instrumentName: instrumentName.trim(),
            photo: photoData,
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
                message: `Reference number '${req.body.refNo}' already exists`
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
        const { refNo, instrumentName, notes } = req.body;
        const files = req.files;

        const updateData = {};
        if (refNo !== undefined) updateData.refNo = refNo.trim();
        if (instrumentName !== undefined) updateData.instrumentName = instrumentName.trim();
        if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;

        if (files) {
            if (files.photo) {
                const f = Array.isArray(files.photo) ? files.photo[0] : files.photo;
                updateData.photo = {
                    name: f.originalname,
                    url: `/uploads/instrument_master/${path.basename(f.path)}`,
                    path: f.path
                };
            }
            if (files.photos) {
                const flist = Array.isArray(files.photos) ? files.photos : [files.photos];
                const photos = flist.map(f => ({
                    name: f.originalname,
                    url: `/uploads/instrument_master/${path.basename(f.path)}`,
                    path: f.path
                }));
                // Use $push to append or replace? Usually updates replace if provided
                updateData.photos = photos;
            }
        }

        const record = await InstrumentMaster.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!record) {
            return res.status(404).json({ success: false, message: 'Instrument not found' });
        }
        res.json({ success: true, message: 'Instrument updated successfully', data: record });
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
