const EmployeeLedger = require('../models/EmployeeLedger');
const EmployeeMaster = require('../models/EmployeeMaster');
const MoneyTransferAccount = require('../models/MoneyTransferAccount');

const buildNameMap = async () => {
    const emps = await EmployeeMaster.find({}, 'name').lean();
    const customAccs = await MoneyTransferAccount.find({}, 'name').lean();
    const map = {};
    emps.forEach(e => map[String(e._id)] = { _id: e._id, name: e.name });
    customAccs.forEach(c => map[String(c._id)] = { _id: c._id, name: `${c.name} (BANK)` });
    return map;
};

exports.getEmployeeLedger = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        const filter = { employee: employeeId };
        if (startDate && endDate) {
            filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const history = await EmployeeLedger.find(filter).lean().sort({ date: 1 });
        const nameMap = await buildNameMap();

        // Calculate Balance
        let balance = 0;
        const formattedHistory = history.map(item => {
            if (item.type === 'Credit') balance += item.amount;
            else balance -= item.amount;
            
            return {
                ...item,
                relatedEmployee: item.relatedEmployee ? (nameMap[String(item.relatedEmployee)] || { _id: item.relatedEmployee, name: 'Unknown' }) : null,
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

        const report = await EmployeeLedger.find(filter).lean().sort({ date: -1 });
        const nameMap = await buildNameMap();

        const formatted = report.map(item => ({
            ...item,
            employee: item.employee ? (nameMap[String(item.employee)] || { _id: item.employee, name: 'Unknown' }) : null,
            relatedEmployee: item.relatedEmployee ? (nameMap[String(item.relatedEmployee)] || { _id: item.relatedEmployee, name: 'Unknown' }) : null
        }));

        res.json({ success: true, data: formatted });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
