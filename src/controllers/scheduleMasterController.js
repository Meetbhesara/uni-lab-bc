const ScheduleMaster = require('../models/ScheduleMaster');
const SiteMaster = require('../models/SiteMaster');
const ClientMaster = require('../models/ClientMaster');
const mongoose = require('mongoose');
const path = require('path');

// POST - Create a new schedule
const createSchedule = async (req, res) => {
    try {
        const { client, site, scheduleDate, workForAppley, operative, helpers, notes, status, dayStatus, ledger, amount, vehicle, instruments } = req.body;

        if (!client || !site || !scheduleDate) {
            return res.status(400).json({
                success: false,
                message: 'Client, site, and schedule date are required'
            });
        }

        const schedule = new ScheduleMaster({
            client,
            site,
            scheduleDate,
            workForAppley,
            operative: operative || undefined,
            helpers: helpers || [],
            ledger,
            amount,
            notes,
            vehicle: vehicle || null,
            instruments: instruments || [],
            status: status || 'Active',
            dayStatus: dayStatus || 'Scheduled'
        });

        await schedule.save();
        const populated = await ScheduleMaster.findById(schedule._id)
            .populate('client', 'clientName clientId')
            .populate('site', 'siteName siteAddress ledgerItems')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model');

        res.status(201).json({ success: true, message: 'Schedule created successfully', data: populated });
    } catch (error) {
        console.error('Error in createSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT - Partially update an existing schedule  
const updateSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        // Only update fields that are actually provided
        const updates = {};
        const unsets = {};
        const allowedFields = ['client', 'site', 'scheduleDate', 'workForAppley', 'operative', 'helpers', 'notes', 'status', 'dayStatus', 'ledger', 'amount', 'vehicle', 'instruments'];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                // If the field is an ObjectId field and is an empty string, set it to undefined/null
                if (['operative', 'vehicle'].includes(field) && req.body[field] === "") {
                    updates[field] = null;
                } else {
                    updates[field] = req.body[field];
                }
            }
        });

        // Clear legacy fields via $unset to prevent CastError on ObjectIds
        if (updates.workForAppley !== undefined) unsets.contactPerson = 1;
        if (updates.operativeNames !== undefined) unsets.operativeName = 1;

        if (Object.keys(updates).length === 0 && Object.keys(unsets).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields provided for update' });
        }

        const updateOperation = { $set: updates };
        if (Object.keys(unsets).length > 0) {
            updateOperation.$unset = unsets;
        }

        const schedule = await ScheduleMaster.findByIdAndUpdate(
            id,
            updateOperation,
            { new: true, runValidators: false }
        )
            .populate('client', 'clientName clientId')
            .populate('site', 'siteName siteAddress ledgerItems')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model');

        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Schedule not found' });
        }

        res.json({ success: true, message: 'Schedule updated successfully', data: schedule });
    } catch (error) {
        console.error('Error in updateSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET - Get schedules with optional date filter
const getSchedules = async (req, res) => {
    try {
        const { date, startDate, endDate, client, site } = req.query;
        const filter = {};

        // Date-wise filtering
        if (date) {
            const d = new Date(date);
            const nextDay = new Date(d);
            nextDay.setDate(d.getDate() + 1);
            filter.scheduleDate = { $gte: d, $lt: nextDay };
        } else if (startDate && endDate) {
            filter.scheduleDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        if (client) filter.client = client;
        if (site) filter.site = site;
        
        // Add employee filtering logic (if assigned as leader OR helper)
        const { employee } = req.query;
        if (employee) {
            filter.$or = [
                { operative: employee },
                { helpers: employee }
            ];
        }

        const schedules = await ScheduleMaster.find(filter)
            .populate('client', 'clientName clientId')
            .populate('site', 'siteName siteAddress ledgerItems')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model')
            .sort({ scheduleDate: 1 });

        res.json({ success: true, data: schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET - Get sites for a specific client
const getSitesByClient = async (req, res) => {
    try {
        const { clientId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(clientId)) {
            return res.status(400).json({ success: false, message: 'Invalid client ID format' });
        }
        const sites = await SiteMaster.find({ 
            client: new mongoose.Types.ObjectId(clientId),
            status: 'Active' 
        }).select('siteName siteAddress contactPersons contactPhone ledgerItems');

        console.log(`Found ${sites.length} sites for client ${clientId}`);


        res.json({ success: true, data: sites });
    } catch (error) {
        console.error('Error in getSitesByClient:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST - Complete schedule with files
const completeSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;


        const schedule = await ScheduleMaster.findById(id);
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

        const siteId = schedule.site?._id || schedule.site;
        const clientId = schedule.client?._id || schedule.client;

        const site = await SiteMaster.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: 'Related site not found' });

        const clientData = await ClientMaster.findById(clientId);
        const clientShortId = clientData?.clientId?.toLowerCase() || 'unknown_client';
        const siteSubfolder = (site.siteName || 'unknown_site').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const newDocs = [];
        const processFiles = (fieldFiles, subfolder) => {
            if (!fieldFiles) return;
            const flist = Array.isArray(fieldFiles) ? fieldFiles : [fieldFiles];
            flist.forEach(f => {
                newDocs.push({
                    name: f.originalname,
                    url: `/uploads/client_master/${clientShortId}/site_master/${siteSubfolder}/${subfolder}/${path.basename(f.path)}`,
                    path: f.path
                });
            });
        };

        if (files) {
            processFiles(files.photos, 'photos');
            processFiles(files.dailyReports, 'Daily_report');
            processFiles(files.data, 'data');
        }

        // Update SiteMaster documents
        if (newDocs.length > 0) {
            site.documents = [...(site.documents || []), ...newDocs];
            await site.save();
        }

        // Mark schedule as completed
        schedule.dayStatus = 'Completed';
        await schedule.save();

        res.json({
            success: true,
            message: 'Site visit marked as completed and documents stored',
            data: schedule
        });
    } catch (error) {
        console.error('Error in completeSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { createSchedule, updateSchedule, getSchedules, getSitesByClient, completeSchedule };
