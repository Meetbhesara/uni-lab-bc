const mongoose = require('mongoose');
const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const EmployeeLedger = require('../models/EmployeeLedger');

exports.adminAddExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { employeeId, date, clientSites, expenses, otherExpensesList, notes } = req.body;

        if (!employeeId) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Employee ID is required' });
        }

        // 1. Calculate Total Expense
        const standardTotal = (Number(expenses?.breakfast) || 0) + 
                            (Number(expenses?.lunch) || 0) + 
                            (Number(expenses?.dinner) || 0) + 
                            (Number(expenses?.petrol) || 0);
        
        const otherTotal = (JSON.parse(otherExpensesList || '[]')).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const totalExpense = standardTotal + otherTotal;

        // 2. Process Files
        const photos = [];
        const dataFiles = [];
        const dailyReports = [];

        if (req.files) {
            if (req.files.photos) {
                req.files.photos.forEach(f => {
                    const relativePath = f.path.replace(/\\/g, '/').split('/uploads/')[1];
                    photos.push({ name: f.originalname, url: `/uploads/${relativePath}`, path: f.path });
                });
            }
            if (req.files.dailyReports) {
                req.files.dailyReports.forEach(f => {
                    const relativePath = f.path.replace(/\\/g, '/').split('/uploads/')[1];
                    dailyReports.push({ name: f.originalname, url: `/uploads/${relativePath}`, path: f.path });
                });
            }
            if (req.files.data) {
                req.files.data.forEach(f => {
                    const relativePath = f.path.replace(/\\/g, '/').split('/uploads/')[1];
                    dataFiles.push({ name: f.originalname, url: `/uploads/${relativePath}`, path: f.path });
                });
            }
        }

        // 3. Update Employee Balance
        const employee = await EmployeeMaster.findByIdAndUpdate(
            employeeId,
            { $inc: { totalAmount: -totalExpense } },
            { new: true, session }
        );

        // 4. Save Expense Record
        const newExpense = new EmployeeExpense({
            employeeId,
            date: date || new Date(),
            clientSites: JSON.parse(clientSites || '[]'),
            expenses: expenses ? JSON.parse(expenses) : {},
            otherExpensesList: JSON.parse(otherExpensesList || '[]'),
            totalExpense,
            remainingBalance: employee.totalAmount,
            photos,
            dataFiles,
            dailyReports,
            notes
        });

        await newExpense.save({ session });

        // 5. Create Ledger Entry
        await new EmployeeLedger({
            employee: employeeId,
            date: date || new Date(),
            amount: totalExpense,
            type: 'Debit',
            category: 'Expense',
            description: `Daily Expense on ${new Date(date || Date.now()).toLocaleDateString()}`,
            referenceId: newExpense._id
        }).save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(201).json({ success: true, message: 'Expense saved and balance updated', data: newExpense });
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
            .sort({ date: -1 });
        res.json({ success: true, data: expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Placeholder for other standard methods
exports.addExpense = async (req, res) => { /* ... existing mobile logic if needed ... */ };
exports.getExpensesForEmployee = async (req, res) => { /* ... existing mobile logic ... */ };
