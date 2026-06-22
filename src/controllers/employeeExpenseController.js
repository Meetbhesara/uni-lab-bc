const mongoose = require('mongoose');
const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const EmployeeLedger = require('../models/EmployeeLedger');

exports.adminAddExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { employeeId, date, notes, expenses, otherExpensesList, clientSites, attendance, attendanceRemark, givenTo, receivedFrom, fuelType } = req.body;
        if (!employeeId) return res.status(400).json({ success: false, message: 'Employee ID is required' });

        // Parse JSON fields from FormData
        const parsedExpenses = typeof expenses === 'string' ? JSON.parse(expenses) : (expenses || {});
        const parsedOtherExpenses = typeof otherExpensesList === 'string' ? JSON.parse(otherExpensesList) : (otherExpensesList || []);
        const parsedClientSites = typeof clientSites === 'string' ? JSON.parse(clientSites) : (clientSites || []);
        const parsedGivenTo = typeof givenTo === 'string' ? JSON.parse(givenTo) : (givenTo || []);
        const parsedReceivedFrom = typeof receivedFrom === 'string' ? JSON.parse(receivedFrom) : (receivedFrom || []);
        const { deletedExistingFiles } = req.body;
        const parsedDeletedExistingFiles = typeof deletedExistingFiles === 'string' ? JSON.parse(deletedExistingFiles) : (deletedExistingFiles || []);

        // 1. Calculate Totals
        const standardTotal = (Number(parsedExpenses.breakfast) || 0) + 
                            (Number(parsedExpenses.lunch) || 0) + 
                            (Number(parsedExpenses.dinner) || 0) + 
                            (Number(parsedExpenses.petrol) || 0);
        
        const otherTotal = parsedOtherExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        
        // Money Given To Others (Debit for current employee)
        const totalGiven = parsedGivenTo.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        
        // Money Received From Others (Credit for current employee)
        const totalReceived = parsedReceivedFrom.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

        const totalExpense = standardTotal + otherTotal;
        const netImpact = totalExpense + totalGiven - totalReceived;

        // 2. Process Files (from upload.any() array)
        const photos = [];
        const dataFiles = [];
        const dailyReports = [];
        const expenseFiles = { breakfast: [], lunch: [], dinner: [], petrol: [] };

        // Initialize files structure in each clientSite
        parsedClientSites.forEach(cs => {
            cs.files = {
                photos: [],
                dailyReports: [],
                data: [],
                drawing: []
            };
        });

        if (req.files && Array.isArray(req.files)) {
            req.files.forEach(f => {
                const normalizedPath = f.path.replace(/\\/g, '/');
                let relativePath = normalizedPath.includes('/uploads/') ? normalizedPath.split('/uploads/')[1] : (normalizedPath.includes('/storage/') ? normalizedPath.split('/storage/')[1] : normalizedPath);
                // The URL depends on how static files are served; assuming /uploads/ prefix works for local
                const fileUrl = normalizedPath.includes('/uploads/') ? `/uploads/${relativePath}` : `/uploads/${relativePath}`;
                
                const fileObj = { name: f.originalname, url: fileUrl, path: f.path };
                
                if (f.fieldname.startsWith('site_')) {
                    const parts = f.fieldname.split('_'); // ['site', '0', 'photos']
                    const siteIdx = parseInt(parts[1]);
                    const category = parts[2]; // 'photos', 'dailyReports', 'data', 'drawing'
                    
                    if (parsedClientSites[siteIdx]) {
                        if (!parsedClientSites[siteIdx].files) {
                            parsedClientSites[siteIdx].files = {
                                photos: [],
                                dailyReports: [],
                                data: [],
                                drawing: []
                            };
                        }
                        
                        let mappedCategory = category;
                        if (category === 'dailyReports') mappedCategory = 'dailyReports';
                        else if (category === 'data') mappedCategory = 'data';
                        else if (category === 'drawing') mappedCategory = 'drawing';
                        else if (category === 'photos') mappedCategory = 'photos';
                        
                        if (parsedClientSites[siteIdx].files[mappedCategory]) {
                            parsedClientSites[siteIdx].files[mappedCategory].push(fileObj);
                        } else {
                            parsedClientSites[siteIdx].files[mappedCategory] = [fileObj];
                        }
                    }
                } else if (f.fieldname.includes('photos')) {
                    photos.push(fileObj);
                } else if (f.fieldname.includes('dailyReports')) {
                    dailyReports.push(fileObj);
                } else if (f.fieldname.includes('drawing') || f.fieldname.includes('data')) {
                    dataFiles.push(fileObj);
                } else if (f.fieldname.startsWith('expense_')) {
                    const expenseName = f.fieldname.split('_')[1];
                    if (expenseFiles[expenseName]) expenseFiles[expenseName].push(fileObj);
                } else if (f.fieldname.startsWith('otherExpense_')) {
                    const idx = f.fieldname.split('_')[1];
                    if (parsedOtherExpenses[idx]) {
                        if (!parsedOtherExpenses[idx].files) parsedOtherExpenses[idx].files = [];
                        parsedOtherExpenses[idx].files.push(fileObj);
                    }
                }
            });
        }

        // 3. Find if record already exists for this employee and date
        const targetDate = new Date(date || new Date());
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23,59,59,999);

        let existingExpense = await EmployeeExpense.findOne({
            employeeId,
            date: { $gte: startOfDay, $lte: endOfDay }
        }).session(session);

        let employee;
        let savedExpense;

        if (existingExpense) {
            // MERGE / OVERWRITE INTO EXISTING RECORD
            const oldTotalExpense = existingExpense.totalExpense || 0;
            const oldTotalGiven = existingExpense.creditDebit?.givenTo?.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0;
            const oldTotalReceived = existingExpense.creditDebit?.receivedFrom?.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0;
            const oldNetImpact = oldTotalExpense + oldTotalGiven - oldTotalReceived;

            const difference = netImpact - oldNetImpact;

            // Update Current Employee Balance with the difference
            employee = await EmployeeMaster.findByIdAndUpdate(
                employeeId,
                { $inc: { totalAmount: -difference } },
                { new: true, session }
            );

            // Update details
            existingExpense.attendance = attendance || existingExpense.attendance;
            existingExpense.attendanceRemark = attendanceRemark || '';
            existingExpense.notes = notes || '';
            
            // Process deleted existing files
            if (parsedDeletedExistingFiles && parsedDeletedExistingFiles.length > 0) {
                existingExpense.clientSites.forEach(cs => {
                    if (cs.files) {
                        ['photos', 'dailyReports', 'data', 'drawing'].forEach(cat => {
                            if (cs.files[cat] && cs.files[cat].length > 0) {
                                cs.files[cat] = cs.files[cat].filter(f => !parsedDeletedExistingFiles.includes(f.url || f));
                            }
                        });
                    }
                });
                
                ['photos', 'dataFiles', 'dailyReports'].forEach(cat => {
                    if (existingExpense[cat] && existingExpense[cat].length > 0) {
                        existingExpense[cat] = existingExpense[cat].filter(f => !parsedDeletedExistingFiles.includes(f.url || f));
                    }
                });

                if (existingExpense.expenseFiles) {
                    ['breakfast', 'lunch', 'dinner', 'petrol'].forEach(key => {
                        if (existingExpense.expenseFiles[key]) {
                            existingExpense.expenseFiles[key] = existingExpense.expenseFiles[key].filter(
                                f => !parsedDeletedExistingFiles.includes(f.url || f)
                            );
                        }
                    });
                }
            }

            // Merge clientSites
            for (const newSite of parsedClientSites) {
                const existingSite = existingExpense.clientSites.find(cs => {
                    if (newSite.scheduleId && cs.scheduleId) {
                        return String(cs.scheduleId) === String(newSite.scheduleId);
                    }
                    if (newSite.scheduleId || cs.scheduleId) {
                        return false;
                    }
                    return String(cs.siteId) === String(newSite.siteId) && String(cs.clientId) === String(newSite.clientId);
                });
                
                if (newSite.scheduleId) {
                    const updateObj = {};
                    if (newSite.ledger) updateObj.ledger = newSite.ledger;
                    if (newSite.quantity !== undefined) updateObj.quantity = newSite.quantity;
                    if (Object.keys(updateObj).length > 0) {
                        await mongoose.model('ScheduleMaster').findByIdAndUpdate(
                            newSite.scheduleId,
                            updateObj,
                            { session }
                        );
                    }
                }
                if (existingSite) {
                    if (newSite.ledger) existingSite.ledger = newSite.ledger;
                    if (newSite.quantity !== undefined) existingSite.quantity = newSite.quantity;
                    
                    if (newSite.files) {
                        ['photos', 'dailyReports', 'data', 'drawing'].forEach(cat => {
                            if (newSite.files[cat] && newSite.files[cat].length > 0) {
                                if (!existingSite.files) existingSite.files = { photos: [], dailyReports: [], data: [], drawing: [] };
                                if (!existingSite.files[cat]) existingSite.files[cat] = [];
                                existingSite.files[cat].push(...newSite.files[cat]);
                            }
                        });
                    }
                } else {
                    existingExpense.clientSites.push(newSite);
                }
            }

            // Overwrite expenses (Breakfast, Lunch, Dinner, Petrol)
            existingExpense.expenses = parsedExpenses;
            if (fuelType) {
                existingExpense.expenses.fuelType = fuelType;
            }

            // Merge/append new standard expense files
            if (!existingExpense.expenseFiles) {
                existingExpense.expenseFiles = { breakfast: [], lunch: [], dinner: [], petrol: [] };
            }
            ['breakfast', 'lunch', 'dinner', 'petrol'].forEach(key => {
                if (expenseFiles[key] && expenseFiles[key].length > 0) {
                    if (!existingExpense.expenseFiles[key]) existingExpense.expenseFiles[key] = [];
                    existingExpense.expenseFiles[key].push(...expenseFiles[key]);
                }
            });

            // Overwrite otherExpensesList
            existingExpense.otherExpensesList = parsedOtherExpenses;

            // Merge Givers and Takers if they were provided (or preserve existing)
            if (!existingExpense.creditDebit) {
                existingExpense.creditDebit = { givenTo: [], receivedFrom: [] };
            }
            if (req.body.givenTo !== undefined) {
                existingExpense.creditDebit.givenTo = parsedGivenTo;
            }
            if (req.body.receivedFrom !== undefined) {
                existingExpense.creditDebit.receivedFrom = parsedReceivedFrom;
            }

            // Merge photos, dataFiles, dailyReports
            if (photos.length > 0) {
                if (!existingExpense.photos) existingExpense.photos = [];
                existingExpense.photos.push(...photos);
            }
            if (dataFiles.length > 0) {
                if (!existingExpense.dataFiles) existingExpense.dataFiles = [];
                existingExpense.dataFiles.push(...dataFiles);
            }
            if (dailyReports.length > 0) {
                if (!existingExpense.dailyReports) existingExpense.dailyReports = [];
                existingExpense.dailyReports.push(...dailyReports);
            }

            existingExpense.totalExpense = totalExpense;
            existingExpense.remainingBalance = employee.totalAmount;

            savedExpense = await existingExpense.save({ session });

            // Delete old Ledger Entry for Expense so we can recreate it with new amount
            await EmployeeLedger.deleteMany({ referenceId: existingExpense._id, category: 'Expense' }, { session });
        } else {
            // SAVE AS NEW EXPENSE RECORD
            employee = await EmployeeMaster.findByIdAndUpdate(
                employeeId,
                { $inc: { totalAmount: -netImpact } },
                { new: true, session }
            );

            const newExpense = new EmployeeExpense({
                employeeId,
                date: date || new Date(),
                clientSites: parsedClientSites,
                expenses: parsedExpenses,
                expenseFiles,
                otherExpensesList: parsedOtherExpenses,
                totalExpense,
                remainingBalance: employee.totalAmount,
                notes,
                attendance: attendance || 'Present',
                attendanceRemark,
                creditDebit: {
                    givenTo: parsedGivenTo,
                    receivedFrom: parsedReceivedFrom
                },
                photos,
                dataFiles,
                dailyReports
            });
            savedExpense = await newExpense.save({ session });
            
            // Update ScheduleMaster ledger and quantity if provided and a scheduleId is present
            for (const newSite of parsedClientSites) {
                if (newSite.scheduleId) {
                    const updateObj = {};
                    if (newSite.ledger) updateObj.ledger = newSite.ledger;
                    if (newSite.quantity !== undefined) updateObj.quantity = newSite.quantity;
                    if (Object.keys(updateObj).length > 0) {
                        await mongoose.model('ScheduleMaster').findByIdAndUpdate(
                            newSite.scheduleId,
                            updateObj,
                            { session }
                        );
                    }
                }
            }
        }

        const expenseDate = date || new Date();

        // 5. Create Ledger Entry for Expense
        if (totalExpense > 0) {
            await new EmployeeLedger({
                employee: employeeId,
                date: expenseDate,
                amount: totalExpense,
                type: 'Debit',
                category: 'Expense',
                description: existingExpense 
                    ? `Daily Expense on ${new Date(expenseDate).toLocaleDateString()} (Updated)`
                    : `Daily Expense on ${new Date(expenseDate).toLocaleDateString()}`,
                referenceId: savedExpense._id
            }).save({ session });
        }

        // 6. Handle Internal Transfers (Given To)
        for (const item of parsedGivenTo) {
            if (item.employeeRef && item.amount > 0) {
                // Update receiver's balance (Credit)
                await EmployeeMaster.findByIdAndUpdate(item.employeeRef, { $inc: { totalAmount: item.amount } }, { session });
                
                // Ledger for Giver (Current Employee)
                await new EmployeeLedger({
                    employee: employeeId,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Debit',
                    category: 'Transfer',
                    description: `Money Given to employee`,
                    relatedEmployee: item.employeeRef,
                    referenceId: savedExpense._id
                }).save({ session });

                // Ledger for Taker
                await new EmployeeLedger({
                    employee: item.employeeRef,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Credit',
                    category: 'Transfer',
                    description: `Money Received from ${employee.name}`,
                    relatedEmployee: employeeId,
                    referenceId: savedExpense._id
                }).save({ session });
            }
        }

        // 7. Handle Internal Transfers (Received From)
        for (const item of parsedReceivedFrom) {
            if (item.employeeRef && item.amount > 0) {
                // Update giver's balance (Debit)
                const giver = await EmployeeMaster.findByIdAndUpdate(item.employeeRef, { $inc: { totalAmount: -item.amount } }, { new: true, session });
                
                // Ledger for Taker (Current Employee)
                await new EmployeeLedger({
                    employee: employeeId,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Credit',
                    category: 'Transfer',
                    description: `Money Received from employee`,
                    relatedEmployee: item.employeeRef,
                    referenceId: savedExpense._id
                }).save({ session });

                // Ledger for Giver
                await new EmployeeLedger({
                    employee: item.employeeRef,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Debit',
                    category: 'Transfer',
                    description: `Money Given to ${employee.name}`,
                    relatedEmployee: employeeId,
                    referenceId: savedExpense._id
                }).save({ session });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({ 
            success: true, 
            message: existingExpense ? 'Expense merged and balance updated' : 'Expense saved and balance updated', 
            data: savedExpense,
            updatedEmployee: employee
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('adminAddExpense Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;
        const expense = await EmployeeExpense.findById(id);
        if (!expense) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Expense record not found' });
        }

        // Reverse Balance Update
        await EmployeeMaster.findByIdAndUpdate(
            expense.employeeId,
            { $inc: { totalAmount: expense.totalExpense } },
            { session }
        );

        // Remove Ledger Entry
        await EmployeeLedger.deleteMany({ referenceId: expense._id }, { session });

        // Remove Expense
        await EmployeeExpense.findByIdAndDelete(id, { session });

        await session.commitTransaction();
        session.endSession();
        res.json({ success: true, message: 'Expense deleted and balance restored' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getExpensesByEmployee = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const expenses = await EmployeeExpense.find({ employeeId })
            .populate('employeeId', 'name')
            .populate('clientSites.clientId', 'clientName')
            .populate('clientSites.siteId', 'siteName')
            .populate('creditDebit.givenTo.employeeRef', 'name')
            .populate('creditDebit.receivedFrom.employeeRef', 'name')
            .sort({ date: -1 });
        res.json({ success: true, data: expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllExpenses = async (req, res) => {
    try {
        const expenses = await EmployeeExpense.find()
            .populate('employeeId', 'name')
            .populate('clientSites.clientId', 'clientName')
            .populate('clientSites.siteId', 'siteName')
            .populate('creditDebit.givenTo.employeeRef', 'name')
            .populate('creditDebit.receivedFrom.employeeRef', 'name')
            .sort({ date: -1 });
        res.json({ success: true, data: expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.addExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const employeeId = req.employee._id;
        const { date, notes, expenses, otherExpensesList, siteIds, attendance, attendanceRemark, creditDebit } = req.body;

        // 1. Calculate Totals
        const standardTotal = (Number(expenses?.breakfast) || 0) + 
                            (Number(expenses?.lunch) || 0) + 
                            (Number(expenses?.dinner) || 0) + 
                            (Number(expenses?.petrol) || 0);
        
        const otherTotal = (otherExpensesList || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        
        const givenTo = creditDebit?.givenTo || [];
        const receivedFrom = creditDebit?.receivedFrom || [];
        
        const totalGiven = givenTo.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const totalReceived = receivedFrom.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

        const totalExpense = standardTotal + otherTotal;
        const netImpact = totalExpense + totalGiven - totalReceived;

        // 2. Update Employee Balance
        const employee = await EmployeeMaster.findByIdAndUpdate(
            employeeId,
            { $inc: { totalAmount: -netImpact } },
            { new: true, session }
        );

        // 3. Save Expense Record
        const clientSites = (siteIds || []).map(sid => ({ siteId: sid }));
        
        const newExpense = new EmployeeExpense({
            employeeId,
            date: date || new Date(),
            clientSites,
            expenses,
            otherExpensesList,
            totalExpense,
            remainingBalance: employee.totalAmount,
            notes,
            attendance: attendance || 'Present',
            attendanceRemark,
            creditDebit: {
                givenTo,
                receivedFrom
            }
        });

        await newExpense.save({ session });

        const expenseDate = date || new Date();

        // 4. Create Ledger Entry for Expense
        if (totalExpense > 0) {
            await new EmployeeLedger({
                employee: employeeId,
                date: expenseDate,
                amount: totalExpense,
                type: 'Debit',
                category: 'Expense',
                description: `Daily Expense on ${new Date(expenseDate).toLocaleDateString()}`,
                referenceId: newExpense._id
            }).save({ session });
        }

        // 5. Handle Internal Transfers (Given To)
        for (const item of givenTo) {
            if (item.employeeRef && item.amount > 0) {
                await EmployeeMaster.findByIdAndUpdate(item.employeeRef, { $inc: { totalAmount: item.amount } }, { session });
                
                await new EmployeeLedger({
                    employee: employeeId,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Debit',
                    category: 'Transfer',
                    description: `Money Given to employee`,
                    relatedEmployee: item.employeeRef,
                    referenceId: newExpense._id
                }).save({ session });

                await new EmployeeLedger({
                    employee: item.employeeRef,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Credit',
                    category: 'Transfer',
                    description: `Money Received from ${employee.name}`,
                    relatedEmployee: employeeId,
                    referenceId: newExpense._id
                }).save({ session });
            }
        }

        // 6. Handle Internal Transfers (Received From)
        for (const item of receivedFrom) {
            if (item.employeeRef && item.amount > 0) {
                await EmployeeMaster.findByIdAndUpdate(item.employeeRef, { $inc: { totalAmount: -item.amount } }, { session });
                
                await new EmployeeLedger({
                    employee: employeeId,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Credit',
                    category: 'Transfer',
                    description: `Money Received from employee`,
                    relatedEmployee: item.employeeRef,
                    referenceId: newExpense._id
                }).save({ session });

                await new EmployeeLedger({
                    employee: item.employeeRef,
                    date: expenseDate,
                    amount: item.amount,
                    type: 'Debit',
                    category: 'Transfer',
                    description: `Money Given to ${employee.name}`,
                    relatedEmployee: employeeId,
                    referenceId: newExpense._id
                }).save({ session });
            }
        }

        await session.commitTransaction();
        session.endSession();
        res.status(201).json({ success: true, message: 'Expense saved successfully', data: newExpense });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('addExpense Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getExpensesForEmployee = async (req, res) => {
    try {
        const employeeId = req.employee._id;
        const expenses = await EmployeeExpense.find({ employeeId })
            .populate('employeeId', 'name')
            .populate('clientSites.siteId', 'siteName siteAddress')
            .populate('creditDebit.givenTo.employeeRef', 'name')
            .populate('creditDebit.receivedFrom.employeeRef', 'name')
            .sort({ date: -1 });
        res.json({ success: true, data: expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── GET: Fetch attendance records for unscheduled employees on a given date ──
exports.getAttendanceByDate = async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: 'date query param is required' });

        // Build strict 24-hour local range
        const [year, month, day] = date.split('-').map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
        const endOfDay   = new Date(year, month - 1, day, 23, 59, 59, 999);

        // Fetch only records that have attendance set but zero expenses
        // (these are the "attendance-only" records created by bulkSaveAttendance)
        const records = await EmployeeExpense.find({
            date: { $gte: startOfDay, $lte: endOfDay },
            attendance: { $exists: true }
        }).select('employeeId attendance attendanceRemark');

        const data = records.map(r => ({
            employeeId: String(r.employeeId),
            attendance: r.attendance,
            attendanceRemark: r.attendanceRemark || ''
        }));

        res.json({ success: true, data });
    } catch (error) {
        console.error('getAttendanceByDate Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ── POST: Bulk upsert attendance for unscheduled employees (no money touched) ──
exports.bulkSaveAttendance = async (req, res) => {
    try {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ success: false, message: 'No entries provided' });
        }

        const saved = [];

        for (const entry of entries) {
            const { employeeId, date, attendance, attendanceRemark } = entry;
            if (!employeeId || !date || !attendance) continue;

            // Build strict 24-hour local range for the entry date
            const [year, month, day] = date.split('-').map(Number);
            const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
            const endOfDay   = new Date(year, month - 1, day, 23, 59, 59, 999);

            // Upsert: update attendance if record exists, else create a minimal one
            const updated = await EmployeeExpense.findOneAndUpdate(
                {
                    employeeId,
                    date: { $gte: startOfDay, $lte: endOfDay }
                },
                {
                    $set: {
                        attendance,
                        attendanceRemark: attendanceRemark || ''
                    },
                    $setOnInsert: {
                        employeeId,
                        date: startOfDay,
                        expenses: { breakfast: 0, lunch: 0, dinner: 0, petrol: 0 },
                        otherExpensesList: [],
                        totalExpense: 0,
                        clientSites: []
                    }
                },
                { upsert: true, new: true }
            );

            saved.push({ employeeId: String(updated.employeeId), attendance: updated.attendance, attendanceRemark: updated.attendanceRemark });
        }

        res.json({ success: true, message: `${saved.length} attendance record(s) saved`, data: saved });
    } catch (error) {
        console.error('bulkSaveAttendance Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
