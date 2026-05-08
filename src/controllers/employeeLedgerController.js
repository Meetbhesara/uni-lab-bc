const EmployeeLedger = require('../models/EmployeeLedger');

exports.getEmployeeLedger = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        const filter = { employee: employeeId };
        if (startDate && endDate) {
            filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const history = await EmployeeLedger.find(filter)
            .populate('relatedEmployee', 'name')
            .sort({ date: 1 });

        // Calculate Balance
        let balance = 0;
        const formattedHistory = history.map(item => {
            if (item.type === 'Credit') balance += item.amount;
            else balance -= item.amount;
            
            return {
                ...item.toObject(),
                runningBalance: balance
            };
        });

        res.json({ success: true, data: formattedHistory, totalBalance: balance });
    } catch (error) {
        console.error('getEmployeeLedger Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.getGeneralReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const filter = {};
        if (startDate && endDate) {
            filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const report = await EmployeeLedger.find(filter)
            .populate('employee', 'name')
            .populate('relatedEmployee', 'name')
            .sort({ date: -1 });

        res.json({ success: true, data: report });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
