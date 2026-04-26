const EmployeeExpense = require('../models/EmployeeExpense');

exports.addExpense = async (req, res) => {
    try {
        const employeeId = req.employee.id; // from auth middleware for employees
        const { date, siteId, siteIds, attendance, expenses, creditDebit, otherExpensesList, notes } = req.body;

        const newExpense = new EmployeeExpense({
            employeeId,
            date: date || new Date(),
            siteId: siteId || null,
            siteIds: siteIds || [],
            attendance,
            expenses,
            otherExpensesList,
            creditDebit,
            notes
        });

        await newExpense.save();
        res.status(201).json({ msg: 'Expense and attendance saved successfully', data: newExpense });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
};

exports.adminAddExpense = async (req, res) => {
    try {
        const { employeeId, date, siteId, siteIds, attendance, expenses, creditDebit, otherExpensesList, notes } = req.body;

        if (!employeeId) {
            return res.status(400).json({ success: false, message: 'Employee ID is required' });
        }

        const newExpense = new EmployeeExpense({
            employeeId,
            date: date || new Date(),
            siteId: siteId || null,
            siteIds: siteIds || [],
            attendance,
            expenses,
            otherExpensesList,
            creditDebit,
            notes
        });

        await newExpense.save();

        const expenseDate = date ? new Date(date) : new Date();

        // Dual-entry: if employee A gives to B, B receives from A
        if (creditDebit && creditDebit.givenTo && creditDebit.givenTo.length > 0) {
            for (let given of creditDebit.givenTo) {
                let startOfDay = new Date(expenseDate);
                startOfDay.setUTCHours(0,0,0,0);
                let endOfDay = new Date(expenseDate);
                endOfDay.setUTCHours(23,59,59,999);

                let otherExp = await EmployeeExpense.findOne({
                    employeeId: given.employeeRef,
                    date: { $gte: startOfDay, $lte: endOfDay }
                });

                if (!otherExp) {
                    otherExp = new EmployeeExpense({
                        employeeId: given.employeeRef,
                        date: startOfDay,
                        attendance: 'Present',
                        creditDebit: { givenTo: [], receivedFrom: [] }
                    });
                }
                
                if (!otherExp.creditDebit) otherExp.creditDebit = { givenTo: [], receivedFrom: [] };
                if (!otherExp.creditDebit.receivedFrom) otherExp.creditDebit.receivedFrom = [];
                
                otherExp.creditDebit.receivedFrom.push({
                    employeeRef: employeeId,
                    amount: given.amount
                });
                await otherExp.save();
            }
        }

        // Dual-entry: if employee A receives from C, C gave to A
        if (creditDebit && creditDebit.receivedFrom && creditDebit.receivedFrom.length > 0) {
            for (let received of creditDebit.receivedFrom) {
                let startOfDay = new Date(expenseDate);
                startOfDay.setUTCHours(0,0,0,0);
                let endOfDay = new Date(expenseDate);
                endOfDay.setUTCHours(23,59,59,999);

                let otherExp = await EmployeeExpense.findOne({
                    employeeId: received.employeeRef,
                    date: { $gte: startOfDay, $lte: endOfDay }
                });

                if (!otherExp) {
                    otherExp = new EmployeeExpense({
                        employeeId: received.employeeRef,
                        date: startOfDay,
                        attendance: 'Present',
                        creditDebit: { givenTo: [], receivedFrom: [] }
                    });
                }
                
                if (!otherExp.creditDebit) otherExp.creditDebit = { givenTo: [], receivedFrom: [] };
                if (!otherExp.creditDebit.givenTo) otherExp.creditDebit.givenTo = [];
                
                otherExp.creditDebit.givenTo.push({
                    employeeRef: employeeId,
                    amount: received.amount
                });
                await otherExp.save();
            }
        }
        res.status(201).json({ success: true, message: 'Expense and attendance saved successfully', data: newExpense });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.getExpensesForEmployee = async (req, res) => {
    try {
        const employeeId = req.employee.id;
        const expenses = await EmployeeExpense.find({ employeeId })
            .populate('siteId', 'siteName siteAddress')
            .populate('siteIds', 'siteName siteAddress')
            .populate('creditDebit.givenTo.employeeRef', 'name')
            .populate('creditDebit.receivedFrom.employeeRef', 'name')
            .sort({ date: -1 });

        res.json({ data: expenses });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
};

exports.getAllExpenses = async (req, res) => {
    try {
        // Admin access route if needed
        const expenses = await EmployeeExpense.find()
            .populate('employeeId', 'name')
            .populate('siteId', 'siteName siteAddress')
            .populate('siteIds', 'siteName siteAddress')
            .sort({ date: -1 });
        res.json({ data: expenses });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
};

exports.getExpensesByEmployee = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const expenses = await EmployeeExpense.find({ employeeId })
            .populate('employeeId', 'name')
            .populate('siteId', 'siteName siteAddress')
            .populate('siteIds', 'siteName siteAddress')
            .populate('creditDebit.givenTo.employeeRef', 'name')
            .populate('creditDebit.receivedFrom.employeeRef', 'name')
            .sort({ date: 1 }); // Sort chronologically for table sheet
        res.json({ success: true, data: expenses });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
