const mongoose = require('mongoose');
const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const EmployeeLedger = require('../models/EmployeeLedger');

exports.adminAddExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { employeeId, date, notes, expenses, otherExpensesList, clientSites, attendance, attendanceRemark, givenTo, receivedFrom } = req.body;
        if (!employeeId) return res.status(400).json({ success: false, message: 'Employee ID is required' });

        // Parse JSON fields from FormData
        const parsedExpenses = typeof expenses === 'string' ? JSON.parse(expenses) : (expenses || {});
        const parsedOtherExpenses = typeof otherExpensesList === 'string' ? JSON.parse(otherExpensesList) : (otherExpensesList || []);
        const parsedClientSites = typeof clientSites === 'string' ? JSON.parse(clientSites) : (clientSites || []);
        const parsedGivenTo = typeof givenTo === 'string' ? JSON.parse(givenTo) : (givenTo || []);
        const parsedReceivedFrom = typeof receivedFrom === 'string' ? JSON.parse(receivedFrom) : (receivedFrom || []);

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

        if (req.files && Array.isArray(req.files)) {
            req.files.forEach(f => {
                const normalizedPath = f.path.replace(/\\/g, '/');
                let relativePath = normalizedPath.includes('/uploads/') ? normalizedPath.split('/uploads/')[1] : (normalizedPath.includes('/storage/') ? normalizedPath.split('/storage/')[1] : normalizedPath);
                // The URL depends on how static files are served; assuming /uploads/ prefix works for local
                const fileUrl = normalizedPath.includes('/uploads/') ? `/uploads/${relativePath}` : `/uploads/${relativePath}`;
                
                const fileObj = { name: f.originalname, url: fileUrl, path: f.path };
                
                if (f.fieldname.includes('photos')) photos.push(fileObj);
                else if (f.fieldname.includes('dailyReports')) dailyReports.push(fileObj);
                else if (f.fieldname.includes('data')) dataFiles.push(fileObj);
                else if (f.fieldname.startsWith('expense_')) {
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

        // 3. Update Current Employee Balance
        const employee = await EmployeeMaster.findByIdAndUpdate(
            employeeId,
            { $inc: { totalAmount: -netImpact } },
            { new: true, session }
        );

        // 4. Save Expense Record
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

        await newExpense.save({ session });

        const expenseDate = date || new Date();

        // 5. Create Ledger Entry for Expense
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
                    referenceId: newExpense._id
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
                    referenceId: newExpense._id
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
                    referenceId: newExpense._id
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
                    referenceId: newExpense._id
                }).save({ session });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.status(201).json({ 
            success: true, 
            message: 'Expense saved and balance updated', 
            data: newExpense,
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
