const ScheduleMaster = require('../models/ScheduleMaster');
const SiteMaster = require('../models/SiteMaster');
const ClientMaster = require('../models/ClientMaster');
const EmployeeExpense = require('../models/EmployeeExpense');
const mongoose = require('mongoose');
const path = require('path');
const { broadcast } = require('../utils/sseManager');
const { sendWhatsapp } = require('../utils/whatsappService');

const getIstDateRange = (dateInput) => {
    const d = new Date(dateInput);
    const istDateString = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
    const [month, day, year] = istDateString.split('/');
    const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
};

// POST - Create a new schedule
const createSchedule = async (req, res) => {
    try {
        const { client, site, scheduleDate, endDate, workForAppley, operative, helpers, notes, status, dayStatus, ledger, amount, vehicle, instruments, scheduleType } = req.body;

        if (!client || !site || !scheduleDate) {
            return res.status(400).json({
                success: false,
                message: 'Client, site, and schedule date are required'
            });
        }

        if (scheduleType === 'MONTH' && endDate) {
            const start = new Date(scheduleDate);
            if (req.body.skipToday) {
                start.setDate(start.getDate() + 1);
            }
            const end = new Date(endDate);
            // Find the highest monthGroupId globally across all schedules
            const lastGroup = await ScheduleMaster.findOne({
                scheduleType: 'MONTH'
            }).sort({ monthGroupId: -1 });

            const newGroupId = (lastGroup && lastGroup.monthGroupId) ? lastGroup.monthGroupId + 1 : 1;
            
            // Only create ONE schedule for the start date. The daily cron/rollover will generate subsequent days.
            const newSchedule = new ScheduleMaster({
                client,
                site,
                scheduleDate: new Date(start),
                endDate: new Date(endDate),
                workForAppley,
                operative: operative || undefined,
                helpers: helpers || [],
                ledger,
                amount,
                notes,
                vehicle: vehicle || null,
                instruments: instruments || [],
                status: status || 'Active',
                dayStatus: dayStatus || 'Scheduled',
                scheduleType: scheduleType || 'VISIT',
                monthGroupId: newGroupId
            });

            await newSchedule.save();
            return res.status(201).json({ success: true, message: `Successfully created the initial month schedule.` });
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
            dayStatus: dayStatus || 'Scheduled',
            scheduleType: scheduleType || 'VISIT'
        });

        await schedule.save();
        const populated = await ScheduleMaster.findById(schedule._id)
            .populate('client', 'clientName clientId')
            .populate('site', 'siteName siteId siteAddress stateName stateCode ledgerItems')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model');

        broadcast('schedule-changed', { action: 'created', id: schedule._id });
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
        const allowedFields = ['client', 'site', 'scheduleDate', 'workForAppley', 'operative', 'helpers', 'notes', 'status', 'dayStatus', 'ledger', 'amount', 'vehicle', 'instruments', 'scheduleType', 'endDate'];
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

        // If dayStatus is set to Rejected, automatically unassign operative & assigned resources
        if (updates.dayStatus === 'Rejected') {
            updates.operative = null;
            updates.helpers = [];
            updates.vehicle = null;
            updates.instruments = [];
        }

        // Clear legacy fields via $unset to prevent CastError on ObjectIds
        if (updates.workForAppley !== undefined) unsets.contactPerson = 1;
        if (updates.operativeNames !== undefined) unsets.operativeName = 1;

        if (Object.keys(updates).length === 0 && Object.keys(unsets).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields provided for update' });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // RESTRICTION: Do not allow changing operative/helpers if daily expenses
        // or client/site data (photos, report, drawing, data) already exist.
        // ─────────────────────────────────────────────────────────────────────────
        if (updates.operative !== undefined || updates.helpers !== undefined) {
            const existingSchedule = await ScheduleMaster.findById(id);
            if (existingSchedule) {
                let operativeChanged = false;
                if (updates.operative !== undefined) {
                    const currentOperativeId = existingSchedule.operative ? String(existingSchedule.operative) : null;
                    const newOperativeId = updates.operative ? String(updates.operative) : null;
                    if (currentOperativeId !== newOperativeId) {
                        operativeChanged = true;
                    }
                }

                let helpersChanged = false;
                if (updates.helpers !== undefined) {
                    const currentHelperIds = (existingSchedule.helpers || []).map(h => String(h)).sort().join(',');
                    const newHelperIds = (updates.helpers || []).map(h => String(h)).sort().join(',');
                    if (currentHelperIds !== newHelperIds) {
                        helpersChanged = true;
                    }
                }

                if (operativeChanged || helpersChanged) {
                    const { start: startOfDay, end: endOfDay } = getIstDateRange(existingSchedule.scheduleDate);

                    const scheduleIdStr = String(existingSchedule._id);

                    // Find any EmployeeExpense documents for the schedule's date that refer to this schedule ID
                    const associatedExpenses = await EmployeeExpense.find({
                        date: { $gte: startOfDay, $lt: endOfDay },
                        "clientSites.scheduleId": existingSchedule._id
                    });

                    for (const exp of associatedExpenses) {
                        const isRelated = (existingSchedule.operative && String(exp.employeeId) === String(existingSchedule.operative)) ||
                                          (existingSchedule.helpers && existingSchedule.helpers.some(h => String(h) === String(exp.employeeId)));

                        if (isRelated) {
                            const cs = exp.clientSites.find(c => String(c.scheduleId) === scheduleIdStr);
                            if (cs) {
                                const hasFiles = cs.files && (
                                    (cs.files.photos && cs.files.photos.length > 0) ||
                                    (cs.files.dailyReports && cs.files.dailyReports.length > 0) ||
                                    (cs.files.data && cs.files.data.length > 0) ||
                                    (cs.files.drawing && cs.files.drawing.length > 0)
                                );

                                const hasExpenses = (
                                    (Number(exp.expenses?.breakfast) || 0) > 0 ||
                                    (Number(exp.expenses?.lunch) || 0) > 0 ||
                                    (Number(exp.expenses?.dinner) || 0) > 0 ||
                                    (Number(exp.expenses?.petrol) || 0) > 0 ||
                                    (exp.otherExpensesList && exp.otherExpensesList.length > 0) ||
                                    (cs.allocatedExpense > 0) ||
                                    (cs.allocatedCredit > 0) ||
                                    (exp.photos && exp.photos.length > 0) ||
                                    (exp.dataFiles && exp.dataFiles.length > 0) ||
                                    (exp.dailyReports && exp.dailyReports.length > 0)
                                );

                                if (hasFiles || hasExpenses) {
                                    return res.status(400).json({
                                        success: false,
                                        message: 'Cannot update operative or helpers because this schedule already contains daily expenses or client/site data (photos, report, drawing, data). Please delete those entries first.'
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // AUTOMATIC EXPENSE & DOCUMENT TRANSFER WHEN OPERATIVE IS CHANGED
        // ─────────────────────────────────────────────────────────────────────────
        let cancelledOperative = null;
        let cancelledSiteName = '';
        let cancelledDate = '';
        
        if ('operative' in updates) {
            const existingSchedule = await ScheduleMaster.findById(id).populate('operative', 'name phone').populate('site', 'siteName');
            const newOperativeId = updates.operative; // null if unassigned, ObjectId string if assigned

            const oldOperativeId = existingSchedule && existingSchedule.operative
                ? String(existingSchedule.operative._id || existingSchedule.operative)
                : null;

            // Only run if operative is actually changing
            const isActualChange = oldOperativeId && oldOperativeId !== String(newOperativeId);
            
            if (isActualChange && existingSchedule.operative?.phone) {
                cancelledOperative = existingSchedule.operative;
                cancelledSiteName = existingSchedule.site?.siteName || 'Unknown Site';
                cancelledDate = existingSchedule.scheduleDate ? new Date(existingSchedule.scheduleDate).toLocaleDateString('en-GB') : 'Unknown Date';
            }

            if (existingSchedule && isActualChange) {
                try {
                    // Build a strict 24-hour IST range for the schedule date
                    const { start: startOfDay, end: endOfDay } = getIstDateRange(existingSchedule.scheduleDate);

                    const scheduleIdStr = String(id);
                    const siteIdStr = String(existingSchedule.site);

                    // Step 1: Find old operative's expense record for this date
                    const oldExpense = await EmployeeExpense.findOne({
                        employeeId: existingSchedule.operative._id || existingSchedule.operative,
                        date: { $gte: startOfDay, $lt: endOfDay }
                    });

                    if (oldExpense && Array.isArray(oldExpense.clientSites)) {
                        // Step 2: Find the exact clientSite block for this schedule/site
                        // Prefer matching by scheduleId, fallback to siteId
                        let siteIndex = oldExpense.clientSites.findIndex(
                            cs => cs.scheduleId && String(cs.scheduleId) === scheduleIdStr
                        );
                        if (siteIndex === -1) {
                            siteIndex = oldExpense.clientSites.findIndex(
                                cs => cs.siteId && String(cs.siteId) === siteIdStr
                            );
                        }

                        if (siteIndex !== -1) {
                            // Extract the block — it contains all files (photos, data, dailyReports, drawing)
                            const extractedBlock = JSON.parse(
                                JSON.stringify(oldExpense.clientSites[siteIndex])
                            );

                            // Step 3: Remove the block from old operative
                            oldExpense.clientSites.splice(siteIndex, 1);

                            if (oldExpense.clientSites.length === 0) {
                                // Old operative had ONLY this site — delete their entire expense for the day
                                await EmployeeExpense.findByIdAndDelete(oldExpense._id);
                            } else {
                                // Old operative still has other sites — just save the updated array
                                oldExpense.markModified('clientSites');
                                await oldExpense.save();
                            }

                            // Step 4: Transfer extracted block to NEW operative (if not unassigned)
                            if (newOperativeId) {
                                const newExpense = await EmployeeExpense.findOne({
                                    employeeId: newOperativeId,
                                    date: { $gte: startOfDay, $lt: endOfDay }
                                });

                                if (newExpense) {
                                    // New operative already has an expense sheet for the day
                                    // Check if this site is already in their sheet to avoid duplicates
                                    const alreadyExists = newExpense.clientSites.findIndex(
                                        cs => (cs.scheduleId && String(cs.scheduleId) === scheduleIdStr) ||
                                              (cs.siteId && String(cs.siteId) === siteIdStr)
                                    );
                                    if (alreadyExists === -1) {
                                        newExpense.clientSites.push(extractedBlock);
                                    } else {
                                        // Overwrite their existing block for this site with the transferred one
                                        newExpense.clientSites[alreadyExists] = extractedBlock;
                                    }
                                    newExpense.markModified('clientSites');
                                    await newExpense.save();
                                } else {
                                    // New operative has NO expense sheet yet for this day — create one
                                    const brandNew = new EmployeeExpense({
                                        employeeId: newOperativeId,
                                        date: startOfDay,
                                        attendance: 'Present',
                                        expenses: { breakfast: 0, lunch: 0, dinner: 0, petrol: 0 },
                                        otherExpensesList: [],
                                        totalExpense: 0,
                                        clientSites: [extractedBlock]
                                    });
                                    await brandNew.save();
                                }
                            }
                            // If newOperativeId is null (unassigned), we already cleaned up above — nothing more to do
                        }
                    }
                } catch (transferErr) {
                    // Log the error but do NOT block the schedule update itself
                    console.error('[Operative Transfer] Error during expense/document transfer:', transferErr);
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────────

        if (updates.scheduleType === 'MONTH' && updates.endDate) {
            const existingSchedule = await ScheduleMaster.findById(id);
            if (existingSchedule && !existingSchedule.monthGroupId) {
                const lastGroup = await ScheduleMaster.findOne({
                    scheduleType: 'MONTH'
                }).sort({ monthGroupId: -1 });
                updates.monthGroupId = (lastGroup && lastGroup.monthGroupId) ? lastGroup.monthGroupId + 1 : 1;
            }
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
            .populate('site', 'siteName siteId siteAddress stateName stateCode ledgerItems contactPersons contactPhone')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model');

        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Schedule not found' });
        }

        // Cascade resource updates to future uncompleted schedules in the same month contract
        if (schedule.scheduleType === 'MONTH' && schedule.monthGroupId && schedule.scheduleDate) {
            const cascadeUpdates = {};
            if (updates.operative !== undefined) cascadeUpdates.operative = updates.operative;
            if (updates.helpers !== undefined) cascadeUpdates.helpers = updates.helpers;
            if (updates.vehicle !== undefined) cascadeUpdates.vehicle = updates.vehicle;
            if (updates.instruments !== undefined) cascadeUpdates.instruments = updates.instruments;

            if (Object.keys(cascadeUpdates).length > 0) {
                await ScheduleMaster.updateMany({
                    monthGroupId: schedule.monthGroupId,
                    scheduleDate: { $gt: schedule.scheduleDate },
                    dayStatus: { $nin: ['Completed', 'Rejected'] }
                }, { $set: cascadeUpdates });
            }
        }

        // Logic for "Include Sunday" from operative allocation
        if (req.body.includeSunday === true && schedule.scheduleType === 'MONTH' && schedule.scheduleDate) {
            const currentDay = new Date(schedule.scheduleDate);
            if (currentDay.getDay() === 6) { // If it's Saturday
                const nextSunday = new Date(currentDay);
                nextSunday.setDate(nextSunday.getDate() + 1);
                
                const existingSunday = await ScheduleMaster.findOne({
                    client: schedule.client._id,
                    site: schedule.site._id,
                    scheduleDate: nextSunday,
                    scheduleType: 'MONTH'
                });

                if (!existingSunday) {
                    await ScheduleMaster.create({
                        client: schedule.client._id,
                        site: schedule.site._id,
                        scheduleDate: nextSunday,
                        workForAppley: schedule.workForAppley,
                        operative: schedule.operative ? schedule.operative._id : null,
                        helpers: schedule.helpers ? schedule.helpers.map(h => h._id) : [],
                        vehicle: schedule.vehicle ? schedule.vehicle._id : null,
                        instruments: schedule.instruments ? schedule.instruments.map(i => i._id) : [],
                        ledger: schedule.ledger,
                        amount: schedule.amount,
                        scheduleType: 'MONTH',
                        monthGroupId: schedule.monthGroupId,
                        dayStatus: 'Scheduled',
                        status: 'Active'
                    });
                }
            }
        }

        if (req.body.skipToday === true) {
            await ScheduleMaster.findByIdAndUpdate(schedule._id, { $set: { dayStatus: 'Skipped' } });
        }

        // WhatsApp Assignment Notifications
        
        // 1. Send Cancellation to Old Operative (if changed)
        if (cancelledOperative && cancelledOperative.phone) {
            try {
                let cancelMsg = `*Schedule Cancelled*\n\n`;
                cancelMsg += `Sorry ${cancelledOperative.name},\n`;
                cancelMsg += `Your scheduled visit for *${cancelledSiteName}* on *${cancelledDate}* has been cancelled or reassigned.\n`;
                cancelMsg += `Please check with the admin for your next assignment.`;
                
                await sendWhatsapp(cancelledOperative.phone, cancelMsg, req.user?.id);
            } catch (err) {
                console.error('[WhatsApp] Failed to send cancellation message:', err.message);
            }
        }

        // 2. Send New Assignment to Current Operative
        if ('operative' in updates && schedule.operative && schedule.operative.phone) {
            try {
                const siteName = schedule.site?.siteName || 'N/A';
                const location = schedule.site?.siteAddress || 'N/A';
                const contactPerson = (schedule.site?.contactPersons && schedule.site.contactPersons.length > 0) ? schedule.site.contactPersons[0] : 'N/A';
                const contactPhone = (schedule.site?.contactPhone && schedule.site.contactPhone.length > 0) ? schedule.site.contactPhone[0] : 'N/A';
                const helpers = (schedule.helpers && schedule.helpers.length > 0) ? schedule.helpers.map(h => h.name).join(', ') : 'None';
                
                let msg = `*Work Assignment*\n\n`;
                if (schedule.scheduleDate) {
                    msg += `*Date:* ${new Date(schedule.scheduleDate).toLocaleDateString('en-GB')}\n`;
                }
                msg += `*Site Name:* ${siteName}\n`;
                msg += `*Location:* ${location}\n`;
                msg += `*Contact Person:* ${contactPerson}\n`;
                msg += `*Contact No:* ${contactPhone}\n`;
                msg += `*Helpers:* ${helpers}\n`;
                
                await sendWhatsapp(schedule.operative.phone, msg, req.user?.id);
            } catch (whatsappErr) {
                console.error('[WhatsApp] Failed to send assignment message:', whatsappErr.message);
            }
        }

        broadcast('schedule-changed', { action: 'updated', id: schedule._id });
        res.json({ success: true, message: 'Schedule updated successfully', data: schedule });
    } catch (error) {
        console.error('Error in updateSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET - Get schedules with optional date filter
const getSchedules = async (req, res) => {
    try {
        // Auto-rollover overdue schedules (before today, and not Completed/Rejected) to the next day
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const cronCutoffDate = new Date('2026-06-01T00:00:00.000Z');

        const overdueSchedules = await ScheduleMaster.find({
            scheduleDate: { $gte: cronCutoffDate, $lt: todayStart },
            dayStatus: { $nin: ['Completed', 'Rejected'] },
            scheduleType: { $ne: 'MONTH' },
            operative: null // ONLY roll over if operative is unassigned
        });

        for (const schedule of overdueSchedules) {
            try {
                if (!schedule.scheduleDate) continue;
                const nextDay = new Date(schedule.scheduleDate);
                nextDay.setDate(nextDay.getDate() + 1);

                let targetDate;
                if (nextDay < todayStart) {
                    const today = new Date();
                    today.setHours(nextDay.getHours(), nextDay.getMinutes(), nextDay.getSeconds(), nextDay.getMilliseconds());
                    targetDate = today;
                } else {
                    targetDate = nextDay;
                }

                // Use updateOne to bypass mongoose validation checks on unrelated legacy fields
                await ScheduleMaster.updateOne(
                    { _id: schedule._id },
                    { $set: { scheduleDate: targetDate } }
                );
            } catch (err) {
                console.error('Failed to rollover schedule:', schedule._id, err.message);
            }
        }

        // Auto-generate the next day for MONTH schedules (if not Paused/Rejected and within endDate)
        const activeMonthSchedules = await ScheduleMaster.find({
            scheduleType: 'MONTH',
            dayStatus: { $nin: ['Paused', 'Rejected'] },
            scheduleDate: { $gte: cronCutoffDate, $lt: todayStart }
        }).sort({ scheduleDate: -1 });

        const processedGroups = new Set();
        for (const doc of activeMonthSchedules) {
            if (!doc.monthGroupId || processedGroups.has(doc.monthGroupId)) continue;
            processedGroups.add(doc.monthGroupId); // Only process the latest schedule for each group

            if (!doc.endDate) continue;
            const endDateObj = new Date(doc.endDate);
            endDateObj.setHours(0, 0, 0, 0);

            if (todayStart <= endDateObj) {
                try {
                    // Check if today's schedule was already generated somehow to prevent duplicates
                    const exists = await ScheduleMaster.findOne({
                        monthGroupId: doc.monthGroupId,
                        scheduleDate: { $gte: todayStart }
                    });

                    if (!exists) {
                        const newSchedule = new ScheduleMaster({
                            client: doc.client,
                            site: doc.site,
                            scheduleDate: todayStart,
                            endDate: doc.endDate,
                            workForAppley: doc.workForAppley,
                            operative: doc.operative,
                            helpers: doc.helpers,
                            ledger: doc.ledger,
                            amount: doc.amount,
                            notes: doc.notes,
                            vehicle: doc.vehicle,
                            instruments: doc.instruments,
                            status: doc.status ? (doc.status.toLowerCase() === 'active' ? 'Active' : (doc.status.toLowerCase() === 'deactive' ? 'Deactive' : doc.status)) : 'Active',
                            dayStatus: 'Scheduled',
                            scheduleType: 'MONTH',
                            monthGroupId: doc.monthGroupId
                        });
                        await newSchedule.save();
                    }
                } catch (err) {
                    console.error('Failed to generate next month schedule:', doc._id, err.message);
                }
            }
        }

        const { date, startDate, endDate, client, site, scheduleType } = req.query;
        const filter = {};
        
        if (scheduleType) {
            filter.scheduleType = scheduleType;
        }

        // Date-wise filtering
        if (date) {
            const [year, month, day] = date.split('T')[0].split('-');
            const dStart = new Date();
            dStart.setFullYear(parseInt(year), parseInt(month) - 1, parseInt(day));
            dStart.setHours(0, 0, 0, 0);
            
            const nextDay = new Date(dStart);
            nextDay.setDate(dStart.getDate() + 1);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (dStart.getTime() === today.getTime()) {
                // If query is today, fetch today AND future data!
                filter.scheduleDate = { $gte: dStart };
            } else {
                // If past date (or specific future date selected via calendar), fetch ONLY that specific day
                filter.scheduleDate = { $gte: dStart, $lt: nextDay };
            }
        } else if (startDate && endDate) {
            filter.scheduleDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        if (client) filter.client = client;
        if (site) filter.site = site;
        if (req.query.scheduleType) filter.scheduleType = req.query.scheduleType;
        if (req.query.workForAppley) filter.workForAppley = new RegExp(req.query.workForAppley, 'i');
        if (req.query.invoiceStatus) filter.invoiceStatus = req.query.invoiceStatus;
        
        // Add employee filtering logic (if assigned as leader OR helper)
        const { employee } = req.query;
        if (employee) {
            filter.$or = [
                { operative: employee },
                { helpers: employee }
            ];
        }

        // Hide any skipped schedules from the active dashboard views
        filter.dayStatus = { $ne: 'Skipped' };

        const schedules = await ScheduleMaster.find(filter)
            .populate('client', 'clientName clientId clientAddress gstNo state contactPerson contactNumbers')
            .populate('site', 'siteName siteId siteAddress stateName stateCode ledgerItems contactPersons contactPhone')
            .populate('operative', 'name phone')
            .populate('helpers', 'name phone')
            .populate('vehicle', 'vehicleNumber vehicleName')
            .populate('instruments', 'instrumentName serialNo model')
            .sort({ scheduleDate: 1 })
            .lean(); // Use lean to allow modification

        // High-performance Map-based EmployeeExpense lookup (O(1) lookup instead of O(N^2) nested loops)
        const scheduleIds = schedules.map(s => s._id);
        const expenses = await EmployeeExpense.find({ "clientSites.scheduleId": { $in: scheduleIds } })
            .select('date employeeId clientSites expenses otherExpensesList photos dataFiles dailyReports expenseFiles')
            .lean();

        const expenseMap = new Map();
        expenses.forEach(e => {
            (e.clientSites || []).forEach(cs => {
                if (cs.scheduleId) {
                    const sidStr = String(cs.scheduleId);
                    if (!expenseMap.has(sidStr)) {
                        expenseMap.set(sidStr, []);
                    }
                    expenseMap.get(sidStr).push({ expense: e, clientSite: cs });
                }
            });
        });

        for (let s of schedules) {
            let docs = [];
            let foundExpenseQty = null;
            let hasExpensesFlag = false;
            
            if (s.site?.documents) {
                docs.push(...s.site.documents);
            }
            
            const relatedExpenses = expenseMap.get(String(s._id)) || [];
            
            relatedExpenses.forEach(({ expense: e, clientSite: cs }) => {
                if (Number(cs.quantity) > 0) {
                    foundExpenseQty = Number(cs.quantity);
                }

                const hasFiles = cs.files && (
                    (cs.files.photos && cs.files.photos.length > 0) ||
                    (cs.files.dailyReports && cs.files.dailyReports.length > 0) ||
                    (cs.files.data && cs.files.data.length > 0) ||
                    (cs.files.drawing && cs.files.drawing.length > 0)
                );

                const hasExp = (
                    (Number(e.expenses?.breakfast) || 0) > 0 ||
                    (Number(e.expenses?.lunch) || 0) > 0 ||
                    (Number(e.expenses?.dinner) || 0) > 0 ||
                    (Number(e.expenses?.petrol) || 0) > 0 ||
                    (e.otherExpensesList && e.otherExpensesList.length > 0) ||
                    (cs.allocatedExpense > 0) ||
                    (cs.allocatedCredit > 0) ||
                    (e.photos && e.photos.length > 0) ||
                    (e.dataFiles && e.dataFiles.length > 0) ||
                    (e.dailyReports && e.dailyReports.length > 0)
                );

                if (hasFiles || hasExp) {
                    hasExpensesFlag = true;
                }

                if (cs.files) {
                    ['photos', 'dailyReports', 'data', 'drawing'].forEach(cat => {
                        if (cs.files[cat]) {
                            cs.files[cat].forEach(f => {
                                docs.push({ name: f.name, url: f.url, uploadedAt: e.date || new Date() });
                            });
                        }
                    });
                }
                
                if (e.photos) e.photos.forEach(f => docs.push({ name: f.name, url: f.url, uploadedAt: e.date }));
                if (e.dataFiles) e.dataFiles.forEach(f => docs.push({ name: f.name, url: f.url, uploadedAt: e.date }));
                if (e.dailyReports) e.dailyReports.forEach(f => docs.push({ name: f.name, url: f.url, uploadedAt: e.date }));
                
                if (e.expenseFiles) {
                    ['breakfast', 'lunch', 'dinner', 'petrol'].forEach(cat => {
                        if (e.expenseFiles[cat]) {
                            e.expenseFiles[cat].forEach(f => docs.push({ name: f.name, url: f.url, uploadedAt: e.date, category: cat }));
                        }
                    });
                }
                if (e.otherExpensesList) {
                    e.otherExpensesList.forEach(oe => {
                        if (oe.files) oe.files.forEach(f => docs.push({ name: f.name, url: f.url, uploadedAt: e.date }));
                    });
                }
            });
            
            if (s.draftingWorkFiles) {
                const dwf = s.draftingWorkFiles;
                const hasDraftingFiles = 
                    (dwf.collectedFiles && dwf.collectedFiles.length > 0) ||
                    (dwf.convertedFiles && dwf.convertedFiles.length > 0) ||
                    (dwf.liningDrawFiles && dwf.liningDrawFiles.length > 0) ||
                    (dwf.esurveyWorkFiles && dwf.esurveyWorkFiles.length > 0) ||
                    (dwf.finalCheckingFiles && dwf.finalCheckingFiles.length > 0) ||
                    (dwf.mailFiles && dwf.mailFiles.length > 0);

                if (hasDraftingFiles) {
                    hasExpensesFlag = true;
                }
            }
            
            if (!s.ledger || s.ledger.trim() === '') {
                s.ledger = 'Visit';
            }
            if (foundExpenseQty !== null) {
                s.quantity = foundExpenseQty;
            }

            s.uploadedDocuments = docs;
            s.hasExpenses = hasExpensesFlag;
        }

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
        }).select('siteName siteAddress stateName stateCode contactPersons contactPhone ledgerItems');

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
        await schedule.save({ validateBeforeSave: false });

        broadcast('schedule-changed', { action: 'completed', id: schedule._id });
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

// PUT - Reject a schedule
const rejectSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejectReason } = req.body;

        if (!rejectReason || !rejectReason.trim()) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
        }

        const schedule = await ScheduleMaster.findById(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Schedule not found' });
        }

        // -------------------------------------------------------------------------
        // RESTRICTION: Do not allow rejecting a schedule if daily expenses
        // or client/site data (photos, report, drawing, data) already exist.
        // -------------------------------------------------------------------------
        const { start: startOfDay, end: endOfDay } = getIstDateRange(schedule.scheduleDate);

        const scheduleIdStr = String(schedule._id);

        // Find any EmployeeExpense documents for the schedule's date that refer to this schedule ID
        const associatedExpenses = await EmployeeExpense.find({
            date: { $gte: startOfDay, $lte: endOfDay },
            "clientSites.scheduleId": schedule._id
        });

        for (const exp of associatedExpenses) {
            const isRelated = (schedule.operative && String(exp.employeeId) === String(schedule.operative)) ||
                              (schedule.helpers && schedule.helpers.some(h => String(h) === String(exp.employeeId)));

            if (isRelated) {
                const cs = exp.clientSites.find(c => String(c.scheduleId) === scheduleIdStr);
                if (cs) {
                    const hasFiles = cs.files && (
                        (cs.files.photos && cs.files.photos.length > 0) ||
                        (cs.files.dailyReports && cs.files.dailyReports.length > 0) ||
                        (cs.files.data && cs.files.data.length > 0) ||
                        (cs.files.drawing && cs.files.drawing.length > 0)
                    );

                    const hasExpenses = (
                        (Number(exp.expenses?.breakfast) || 0) > 0 ||
                        (Number(exp.expenses?.lunch) || 0) > 0 ||
                        (Number(exp.expenses?.dinner) || 0) > 0 ||
                        (Number(exp.expenses?.petrol) || 0) > 0 ||
                        (exp.otherExpensesList && exp.otherExpensesList.length > 0) ||
                        (cs.allocatedExpense > 0) ||
                        (cs.allocatedCredit > 0) ||
                        (exp.photos && exp.photos.length > 0) ||
                        (exp.dataFiles && exp.dataFiles.length > 0) ||
                        (exp.dailyReports && exp.dailyReports.length > 0)
                    );

                    if (hasFiles || hasExpenses) {
                        return res.status(400).json({
                            success: false,
                            message: 'Cannot reject schedule because daily expenses, photos, daily reports, project data, or drawings are present. Delete them first.'
                        });
                    }
                }
            }
        }

        // Also check if drafting files are present on the schedule itself
        if (schedule.draftingWorkFiles) {
            const dwf = schedule.draftingWorkFiles;
            const hasDraftingFiles = 
                (dwf.collectedFiles && dwf.collectedFiles.length > 0) ||
                (dwf.convertedFiles && dwf.convertedFiles.length > 0) ||
                (dwf.liningDrawFiles && dwf.liningDrawFiles.length > 0) ||
                (dwf.esurveyWorkFiles && dwf.esurveyWorkFiles.length > 0) ||
                (dwf.finalCheckingFiles && dwf.finalCheckingFiles.length > 0) ||
                (dwf.mailFiles && dwf.mailFiles.length > 0);

            if (hasDraftingFiles) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot reject schedule because drawing or drafting files are present on this schedule. Delete them first.'
                });
            }
        }

        schedule.dayStatus = 'Rejected';
        schedule.rejectReason = rejectReason.trim();
        schedule.operative = null;
        schedule.helpers = [];
        schedule.vehicle = null;
        schedule.instruments = [];
        await schedule.save({ validateBeforeSave: false });

        broadcast('schedule-changed', { action: 'rejected', id: schedule._id });
        res.json({ success: true, message: 'Schedule marked as rejected', data: schedule });
    } catch (error) {
        console.error('Error in rejectSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH - Update invoice status with optional tracking fields
const updateInvoiceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { invoiceStatus, invoiceDetails, proformaInvoiceId, finalInvoiceId, paymentRemark, paymentMode, receiverName, transactionNo, paymentAmount, closedDate } = req.body;
        if (!['Pending', 'Completed', 'Proforma', 'Final', 'Closed'].includes(invoiceStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid invoice status' });
        }

        // Block moving Proforma / Final / Closed back to Pending (One-way progression strictly enforced)
        if (invoiceStatus === 'Pending') {
            const entry = await ScheduleMaster.findById(id).select('invoiceStatus');
            if (entry && ['Proforma', 'Final', 'Closed'].includes(entry.invoiceStatus)) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot revert "${entry.invoiceStatus}" invoice back to Pending status.`
                });
            }
        }

        const updateObj = { invoiceStatus };
        if (invoiceDetails !== undefined) updateObj.invoiceDetails = invoiceDetails;
        if (proformaInvoiceId !== undefined) updateObj.proformaInvoiceId = proformaInvoiceId;
        if (finalInvoiceId !== undefined) updateObj.finalInvoiceId = finalInvoiceId;
        if (paymentRemark !== undefined) updateObj.paymentRemark = paymentRemark;
        if (paymentMode !== undefined) updateObj.paymentMode = paymentMode;
        if (receiverName !== undefined) updateObj.receiverName = receiverName;
        if (transactionNo !== undefined) updateObj.transactionNo = transactionNo;
        if (paymentAmount !== undefined) updateObj.paymentAmount = paymentAmount;
        if (closedDate !== undefined) updateObj.closedDate = closedDate;
        await ScheduleMaster.updateOne({ _id: id }, { $set: updateObj });
        res.json({ success: true, message: `Invoice marked as ${invoiceStatus}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /schedule-master/generate-invoice
 * Generate ONE Proforma or Final invoice for multiple scheduler entries.
 *
 * Business Rules:
 *   - Multiple entries → ONE merged invoice (single invoiceId shared across all)
 *   - Pending/Completed → Proforma or Final
 *   - Proforma → Final (upgrade path)
 *   - Proforma → Proforma / Final → Final (allow editing invoice details inside same stage)
 *   - Duplicate guard: entries in Final cannot be moved to Proforma, Closed entries cannot be edited
 *
 * NOTE: No MongoDB session/transaction used — requires standalone MongoDB compatible.
 */
const getInvoiceDirectory = (invoiceType) => {
    const path = require('path');
    const fs = require('fs');
    const useNas = process.env.USE_NAS === 'true';
    let baseDir;
    if (useNas) {
        let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        if (!nasBase.startsWith('/')) nasBase = '/' + nasBase;
        baseDir = nasBase;
    } else {
        const localBase = process.env.LOCAL_BASE_PATH || './uploads';
        baseDir = path.isAbsolute(localBase) ? localBase : path.join(__dirname, '..', '..', localBase.replace('./', ''));
    }
    
    const subFolder = invoiceType.toLowerCase().includes('proforma') || invoiceType.toLowerCase().includes('perfoma')
        ? 'perfoma'
        : 'final';
        
    const invoiceDir = path.join(baseDir, 'invoice', subFolder);
    if (!fs.existsSync(invoiceDir)) {
        fs.mkdirSync(invoiceDir, { recursive: true });
    }
    return { invoiceDir, subFolder };
};

const generateSchedulerInvoice = async (req, res) => {
    try {
        const {
            entryIds,       // array of ScheduleMaster._id strings
            invoiceType,    // 'proforma' | 'final'
            invoiceDetails, // the full PDF form data object
            invoiceId,      // client-generated unique invoice ID (e.g. PRM/0001 or UE/2026-27/0001)
            pdfHtml         // pre-rendered HTML content for PDF generation
        } = req.body;

        // ── Validation ────────────────────────────────────────────────────
        if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
            return res.status(400).json({ success: false, message: 'entryIds array is required and must not be empty' });
        }
        if (!['proforma', 'final'].includes(invoiceType)) {
            return res.status(400).json({ success: false, message: 'invoiceType must be "proforma" or "final"' });
        }
        if (!invoiceId) {
            return res.status(400).json({ success: false, message: 'invoiceId is required' });
        }

        // ── Fetch all target entries ───────────────────────────────────────
        const entries = await ScheduleMaster.find({ _id: { $in: entryIds } });

        if (entries.length !== entryIds.length) {
            return res.status(404).json({
                success: false,
                message: `Some entries not found. Expected ${entryIds.length}, found ${entries.length}.`
            });
        }

        // ── Business Rule Guard ────────────────────────────────────────────
        const targetStatus = invoiceType === 'proforma' ? 'Proforma' : 'Final';

        for (const entry of entries) {
            const currentStatus = (entry.invoiceStatus || 'Pending').toLowerCase();

            if (invoiceType === 'proforma') {
                // Allow generating from pending/completed, OR updating an already existing Proforma
                if (!['pending', 'completed', 'proforma'].includes(currentStatus)) {
                    return res.status(409).json({
                        success: false,
                        message: `Entry dated "${entry.scheduleDate}" is in "${entry.invoiceStatus}" status and cannot be modified as Proforma.`
                    });
                }
            }

            if (invoiceType === 'final') {
                // Allow generating from pending/completed/proforma, OR updating an existing Final
                if (currentStatus === 'closed') {
                    return res.status(409).json({
                        success: false,
                        message: `Entry dated "${entry.scheduleDate}" is Closed and cannot be re-invoiced or edited.`
                    });
                }
                if (!['pending', 'completed', 'proforma', 'final'].includes(currentStatus)) {
                    return res.status(409).json({
                        success: false,
                        message: `Entry dated "${entry.scheduleDate}" is in "${entry.invoiceStatus}" status and cannot be modified as Final Invoice.`
                    });
                }
            }
        }

        // ── PDF Generation (if pdfHtml is passed) ──────────────────────────
        let pdfUrl = null;
        if (pdfHtml) {
            const puppeteer = require('puppeteer');
            const path = require('path');
            const sanitizedInvoiceId = invoiceId.replace(/[^a-zA-Z0-9-_]/g, '_');
            const { invoiceDir, subFolder } = getInvoiceDirectory(invoiceType);
            const fileName = `${sanitizedInvoiceId}.pdf`;
            const absolutePdfPath = path.join(invoiceDir, fileName);

            console.log(`[Puppeteer] Generating invoice PDF at: ${absolutePdfPath}`);
            let browser;
            try {
                browser = await puppeteer.launch({ 
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
                });
                const page = await browser.newPage();
                await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
                await new Promise(resolve => setTimeout(resolve, 1000)); // wait a bit for layout/fonts

                await page.pdf({ 
                    path: absolutePdfPath, 
                    format: 'A4',
                    printBackground: true,
                    preferCSSPageSize: true
                });
                await browser.close();
                console.log(`[Puppeteer] Invoice PDF generated successfully.`);
                pdfUrl = `/uploads/invoice/${subFolder}/${fileName}`;
            } catch (err) {
                if (browser) await browser.close();
                console.error('[Puppeteer] Error generating invoice PDF:', err);
            }
        }

        // ── Bulk Update ────────────────────────────────────────────────────
        const cleanDetails = { ...(invoiceDetails || {}) };
        delete cleanDetails.selectedEntries;
        delete cleanDetails.group;
        delete cleanDetails.isExistingInvoice;
        delete cleanDetails.isEditingInvoice;

        if (pdfUrl) {
            cleanDetails.pdfUrl = pdfUrl;
        }

        const updateFields = {
            invoiceStatus: targetStatus,
            invoiceDetails: cleanDetails,
            invoiceLockedAt: new Date()
        };

        if (invoiceType === 'proforma') {
            updateFields.proformaInvoiceId = invoiceId;
            if (pdfUrl) {
                updateFields.proformaInvoicePdf = pdfUrl;
            }
        } else {
            updateFields.finalInvoiceId = invoiceId;
            if (pdfUrl) {
                updateFields.finalInvoicePdf = pdfUrl;
            }
        }

        await ScheduleMaster.updateMany(
            { _id: { $in: entryIds } },
            { $set: updateFields }
        );

        res.json({
            success: true,
            message: `Successfully generated ${invoiceType} invoice "${invoiceId}" for ${entryIds.length} entr${entryIds.length === 1 ? 'y' : 'ies'}.`,
            data: { invoiceId, invoiceType, targetStatus, affectedCount: entryIds.length, pdfUrl }
        });

    } catch (error) {
        console.error('[generateSchedulerInvoice] Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


const pauseMonth = async (req, res) => {
    try {
        const { client, site, monthGroupId } = req.params;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const result = await ScheduleMaster.updateMany({
            client,
            site,
            monthGroupId,
            scheduleType: 'MONTH',
            dayStatus: 'Scheduled',
            scheduleDate: { $gte: today }
        }, { $set: { dayStatus: 'Paused' } });

        res.json({ success: true, message: `Paused future month schedules for this site.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const resumeMonth = async (req, res) => {
    try {
        const { client, site, endDate, workForAppley, operative, ledger, amount, monthGroupId } = req.body;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);

        // 1. Resume any previously paused schedules up to the new endDate
        await ScheduleMaster.updateMany({
            client,
            site,
            monthGroupId,
            scheduleType: 'MONTH',
            dayStatus: 'Paused',
            scheduleDate: { $lte: end, $gte: today }
        }, { $set: { dayStatus: 'Scheduled' } });

        // 2. Remove any remaining Paused schedules beyond endDate (they shortened the contract)
        await ScheduleMaster.deleteMany({
            client,
            site,
            monthGroupId,
            scheduleType: 'MONTH',
            dayStatus: 'Paused',
            scheduleDate: { $gt: end }
        });

        // 3. Find if we need to extend the schedule (if endDate is beyond what was previously generated)
        const lastSchedule = await ScheduleMaster.findOne({
            client,
            site,
            monthGroupId,
            scheduleType: 'MONTH'
        }).sort({ scheduleDate: -1 });

        let startGenerate = new Date(today);
        startGenerate.setDate(startGenerate.getDate() + 1); // default to tomorrow

        if (lastSchedule && lastSchedule.scheduleDate >= today) {
            startGenerate = new Date(lastSchedule.scheduleDate);
            startGenerate.setDate(startGenerate.getDate() + 1);
        }

        const schedulesToInsert = [];
        const includeSundays = req.body.includeSundays === true;
        
        const groupToUse = (lastSchedule && lastSchedule.monthGroupId) ? lastSchedule.monthGroupId : 1;

        for (let d = new Date(startGenerate); d <= end; d.setDate(d.getDate() + 1)) {
            if (!includeSundays && d.getDay() === 0) continue; // Skip Sundays unless allowed
            
            schedulesToInsert.push({
                client, site, scheduleDate: new Date(d), workForAppley,
                operative, ledger, amount, scheduleType: 'MONTH',
                monthGroupId: groupToUse,
                dayStatus: 'Scheduled', status: 'Active'
            });
        }

        if (schedulesToInsert.length > 0) {
            await ScheduleMaster.insertMany(schedulesToInsert);
        }

        res.json({ success: true, message: `Resumed month schedule up to ${end.toDateString()}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const endMonth = async (req, res) => {
    try {
        const { client, site, monthGroupId } = req.params;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        // End the specific contract by rolling back its endDate to yesterday, instantly terminating cron generation
        await ScheduleMaster.updateMany(
            { client, site, monthGroupId },
            { $set: { endDate: yesterday, dayStatus: 'Completed' } }
        );

        res.json({ success: true, message: 'Contract completed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const uploadDraftingWorkFiles = async (req, res) => {
    try {
        const { id } = req.params;
        const schedule = await ScheduleMaster.findById(id);
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

        if (!schedule.draftingWorkFiles) schedule.draftingWorkFiles = {};

        const categories = ['collectedFiles', 'convertedFiles', 'liningDrawFiles', 'esurveyWorkFiles', 'finalCheckingFiles'];
        const { clientShortId, siteSubfolder, originalFileId } = req.body;
        const path = require('path');
        
        categories.forEach(cat => {
            if (req.files && req.files[cat]) {
                const docs = req.files[cat].map(f => {
                    let fileUrl = `/uploads/${path.basename(f.path)}`;
                    if (clientShortId && siteSubfolder) {
                        fileUrl = `/uploads/client_master/${clientShortId}/site_master/${siteSubfolder}/drafting/${path.basename(f.path)}`;
                    }
                    const docObj = {
                        name: f.originalname,
                        url: fileUrl,
                        uploadedAt: new Date()
                    };
                    if (originalFileId) {
                        docObj.originalFileId = originalFileId;
                    }
                    return docObj;
                });
                
                if (!schedule.draftingWorkFiles[cat]) schedule.draftingWorkFiles[cat] = [];
                
                if (originalFileId && cat !== 'esurveyWorkFiles') {
                    const existingIndex = schedule.draftingWorkFiles[cat].findIndex(d => d.originalFileId === originalFileId);
                    if (existingIndex >= 0) {
                        // Override the first file mapping to this originalFileId
                        schedule.draftingWorkFiles[cat][existingIndex] = docs[0];
                        if (docs.length > 1) {
                            schedule.draftingWorkFiles[cat].push(...docs.slice(1));
                        }
                    } else {
                        schedule.draftingWorkFiles[cat].push(...docs);
                    }
                } else {
                    schedule.draftingWorkFiles[cat].push(...docs);
                }
            }
        });

        await schedule.save();

        res.json({ success: true, message: 'Drafting files uploaded successfully', data: schedule.draftingWorkFiles });
    } catch (error) {
        console.error('Error uploading drafting files:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateDraftingWorkFileStatus = async (req, res) => {
    try {
        const { id, category, fileId } = req.params;
        const { status } = req.body;
        const schedule = await ScheduleMaster.findById(id);
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

        if (schedule.draftingWorkFiles && schedule.draftingWorkFiles[category]) {
            const fileObj = schedule.draftingWorkFiles[category].id(fileId);
            if (fileObj) {
                fileObj.status = status;

                if (category === 'esurveyWorkFiles' && status === 'Approved') {
                    if (!schedule.draftingWorkFiles.finalCheckingFiles) schedule.draftingWorkFiles.finalCheckingFiles = [];
                    const exists = schedule.draftingWorkFiles.finalCheckingFiles.some(f => f.originalFileId === fileObj._id.toString());
                    if (!exists) {
                        schedule.draftingWorkFiles.finalCheckingFiles.push({
                            name: fileObj.name,
                            url: fileObj.url,
                            uploadedAt: new Date(),
                            originalFileId: fileObj._id.toString(),
                            status: 'Pending'
                        });
                    }
                } else if (category === 'esurveyWorkFiles' && (status === 'Rejected' || status === 'Pending')) {
                    if (schedule.draftingWorkFiles.finalCheckingFiles) {
                        schedule.draftingWorkFiles.finalCheckingFiles = schedule.draftingWorkFiles.finalCheckingFiles.filter(f => f.originalFileId !== fileObj._id.toString());
                    }
                }

                if (category === 'finalCheckingFiles' && status === 'Approved') {
                    if (!schedule.draftingWorkFiles.mailFiles) schedule.draftingWorkFiles.mailFiles = [];
                    const exists = schedule.draftingWorkFiles.mailFiles.some(f => f.originalFileId === fileObj._id.toString());
                    
                    if (!exists) {
                        const path = require('path');
                        const fs = require('fs');
                        try {
                            const sourceUrl = fileObj.url;
                            const sourceRelativePath = sourceUrl.replace(/^\/uploads\//, '');
                            
                            const useNas = process.env.USE_NAS === 'true';
                            let baseDir;
                            if (useNas) {
                                let nasBase = process.env.NAS_BASE_PATH || '/app/storage';
                                if (!nasBase.startsWith('/')) nasBase = '/' + nasBase;
                                baseDir = nasBase;
                            } else {
                                const localBase = process.env.LOCAL_BASE_PATH || './uploads';
                                baseDir = path.isAbsolute(localBase) ? localBase : path.join(__dirname, '..', '..', localBase.replace('./', ''));
                            }
                            
                            const sourceFullPath = path.join(baseDir, sourceRelativePath);
                            const mailFolder = path.join(path.dirname(sourceFullPath), 'mail');
                            if (!fs.existsSync(mailFolder)) {
                                fs.mkdirSync(mailFolder, { recursive: true });
                            }
                            
                            const mailFileName = path.basename(sourceFullPath);
                            const mailFullPath = path.join(mailFolder, mailFileName);
                            
                            if (fs.existsSync(sourceFullPath)) {
                                fs.copyFileSync(sourceFullPath, mailFullPath);
                                
                                const mailUrlPath = sourceUrl.substring(0, sourceUrl.lastIndexOf('/')) + '/mail/' + mailFileName;
                                
                                schedule.draftingWorkFiles.mailFiles.push({
                                    name: fileObj.name,
                                    url: mailUrlPath,
                                    uploadedAt: new Date(),
                                    originalFileId: fileObj._id.toString(),
                                    status: 'Pending'
                                });
                            }
                        } catch (err) {
                            console.error('Error copying file to mail folder:', err);
                        }
                    }
                    schedule.dayStatus = 'Completed';
                } else if (category === 'finalCheckingFiles' && (status === 'Rejected' || status === 'Pending')) {
                    if (schedule.draftingWorkFiles.mailFiles) {
                        schedule.draftingWorkFiles.mailFiles = schedule.draftingWorkFiles.mailFiles.filter(f => f.originalFileId !== fileObj._id.toString());
                    }
                }

                await schedule.save();
                return res.json({ success: true, message: 'Status updated successfully', data: schedule.draftingWorkFiles });
            }
        }
        res.status(404).json({ success: false, message: 'File not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteDraftingWorkFile = async (req, res) => {
    try {
        const { id, category, fileId } = req.params;
        const schedule = await ScheduleMaster.findById(id);
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

        if (schedule.draftingWorkFiles && schedule.draftingWorkFiles[category]) {
            schedule.draftingWorkFiles[category] = schedule.draftingWorkFiles[category].filter(f => f._id.toString() !== fileId);
            await schedule.save();
        }

        res.json({ success: true, message: 'Drafting file deleted successfully', data: schedule.draftingWorkFiles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE - Delete a schedule entirely
const deleteSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const schedule = await ScheduleMaster.findByIdAndDelete(id);
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Schedule not found' });
        }
        res.json({ success: true, message: 'Schedule deleted successfully' });
    } catch (error) {
        console.error('Error in deleteSchedule:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    createSchedule,
    updateSchedule,
    getSchedules,
    getSitesByClient,
    completeSchedule,
    rejectSchedule,
    updateInvoiceStatus,
    generateSchedulerInvoice,
    pauseMonth,
    resumeMonth,
    endMonth,
    uploadDraftingWorkFiles,
    updateDraftingWorkFileStatus,
    deleteDraftingWorkFile,
    deleteSchedule
};
