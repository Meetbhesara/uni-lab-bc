const mongoose = require('mongoose');
const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const EmployeeLedger = require('../models/EmployeeLedger');

exports.adminAddExpense = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { employeeId, date, notes, expenses, otherExpensesList, clientSites } = req.body;
        if (!employeeId) return res.status(400).json({ success: false, message: 'Employee ID is required' });

        // Parse JSON fields from FormData
        const parsedExpenses = typeof expenses === 'string' ? JSON.parse(expenses) : (expenses || {});
        const parsedOtherExpenses = typeof otherExpensesList === 'string' ? JSON.parse(otherExpensesList) : (otherExpensesList || []);
        const parsedClientSites = typeof clientSites === 'string' ? JSON.parse(clientSites) : (clientSites || []);

        // 1. Calculate Total Expense
        const standardTotal = (Number(parsedExpenses.breakfast) || 0) + 
                            (Number(parsedExpenses.lunch) || 0) + 
                            (Number(parsedExpenses.dinner) || 0) + 
                            (Number(parsedExpenses.petrol) || 0);
        
        const otherTotal = parsedOtherExpenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const totalExpense = standardTotal + otherTotal;

        // 2. Process Files (from upload.any() array)
        const photos = [];
        const dataFiles = [];
        const dailyReports = [];

        if (req.files && Array.isArray(req.files)) {
            req.files.forEach(f => {
                const relativePath = f.path.replace(/\\/g, '/').split('/uploads/')[1];
                const fileObj = { name: f.originalname, url: `/uploads/${relativePath}`, path: f.path };
                
                if (f.fieldname.includes('photos')) photos.push(fileObj);
                else if (f.fieldname.includes('dailyReports')) dailyReports.push(fileObj);
                else if (f.fieldname.includes('data')) dataFiles.push(fileObj);
            });
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
            clientSites: parsedClientSites,
            expenses: parsedExpenses,
            otherExpensesList: parsedOtherExpenses,
            totalExpense,
            remainingBalance: employee.totalAmount,
            notes,
            photos,
            dataFiles,
            dailyReports
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
