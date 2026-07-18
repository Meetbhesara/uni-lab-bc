const MoneyTransferAccount = require('../models/MoneyTransferAccount');

exports.getAccounts = async (req, res) => {
    try {
        const accounts = await MoneyTransferAccount.find({ status: 'Active' }).sort({ name: 1 });
        res.json({ success: true, data: accounts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createAccount = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Account / Bank name is required' });
        }

        const existing = await MoneyTransferAccount.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
        if (existing) {
            if (existing.status === 'Deactive') {
                existing.status = 'Active';
                await existing.save();
                return res.json({ success: true, message: 'Account reactivated successfully', data: existing });
            }
            return res.status(400).json({ success: false, message: 'An account with this name already exists' });
        }

        const account = new MoneyTransferAccount({
            name: name.trim(),
            totalAmount: 0,
            status: 'Active'
        });

        await account.save();
        res.status(201).json({ success: true, message: 'Transfer account created successfully', data: account });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteAccount = async (req, res) => {
    try {
        const { id } = req.params;
        const account = await MoneyTransferAccount.findById(id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Account not found' });
        }
        
        // Soft delete / deactivate
        account.status = 'Deactive';
        await account.save();
        res.json({ success: true, message: 'Account removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
