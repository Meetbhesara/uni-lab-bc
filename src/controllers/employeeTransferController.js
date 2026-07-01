const mongoose = require('mongoose');
const EmployeeTransfer = require('../models/EmployeeTransfer');
const EmployeeLedger = require('../models/EmployeeLedger');
const EmployeeMaster = require('../models/EmployeeMaster');
const { sendWhatsapp } = require('../utils/whatsappService');

// Helper: pause between bulk messages to avoid WhatsApp rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.createTransfer = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { giver, taker, amount, date, notes } = req.body;

        if (!giver || !taker || !amount) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Giver, Taker and Amount are required' });
        }

        const transfer = new EmployeeTransfer({
            giver,
            taker,
            amount,
            date: date || new Date(),
            notes
        });

        await transfer.save({ session });

        // Update Balances
        await EmployeeMaster.findByIdAndUpdate(giver, { $inc: { totalAmount: -amount } }, { session });
        await EmployeeMaster.findByIdAndUpdate(taker, { $inc: { totalAmount: amount } }, { session });

        const transferDate = date ? new Date(date) : new Date();

        // 1. Giver Ledger Entry (Debit)
        await new EmployeeLedger({
            employee: giver,
            date: transferDate,
            amount,
            type: 'Debit',
            category: 'Transfer',
            description: notes || 'Direct Transfer to Employee',
            relatedEmployee: taker,
            referenceId: transfer._id
        }).save({ session });

        // 2. Taker Ledger Entry (Credit)
        await new EmployeeLedger({
            employee: taker,
            date: transferDate,
            amount,
            type: 'Credit',
            category: 'Transfer',
            description: notes || 'Direct Transfer from Employee',
            relatedEmployee: giver,
            referenceId: transfer._id
        }).save({ session });

        await session.commitTransaction();
        session.endSession();

        // ── WhatsApp Notification to Receiver (Taker) ───────────────────────
        // Fetch full details of giver & taker for the message
        try {
            const [giverDoc, takerDoc] = await Promise.all([
                EmployeeMaster.findById(giver).select('name phone'),
                EmployeeMaster.findById(taker).select('name phone')
            ]);

            if (takerDoc && takerDoc.phone) {
                const formattedDate = new Date(date || new Date()).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
                const msg =
                    `💸 *Money Transfer Received!*\n\n` +
                    `*Sender:* *${giverDoc?.name || 'Employee'}*\n` +
                    `*Receiver:* *${takerDoc.name}*\n` +
                    `*Amount:* *₹${Number(amount).toLocaleString('en-IN')}*\n` +
                    `*Date:* ${formattedDate}`;

                await sendWhatsapp(takerDoc.phone, msg, req.user?.id);
            }
        } catch (wpErr) {
            // WhatsApp failure must NOT roll back the transfer
            console.error('[Transfer] WhatsApp notification failed (non-critical):', wpErr.message);
        }
        // ────────────────────────────────────────────────────────────────────

        res.status(201).json({ success: true, message: 'Transfer recorded successfully', data: transfer });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('createTransfer Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.bulkCreateTransfers = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { transfers } = req.body; 

        if (!transfers || !Array.isArray(transfers) || transfers.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'No transfers provided' });
        }

        for (const item of transfers) {
            const { giver, taker, amount, date, notes } = item;

            const transfer = new EmployeeTransfer({
                giver,
                taker,
                amount,
                date: date || new Date(),
                notes
            });

            await transfer.save({ session });

            // Update Balances
            await EmployeeMaster.findByIdAndUpdate(giver, { $inc: { totalAmount: -amount } }, { session });
            await EmployeeMaster.findByIdAndUpdate(taker, { $inc: { totalAmount: amount } }, { session });

            const transferDate = date ? new Date(date) : new Date();

            await new EmployeeLedger({
                employee: giver,
                date: transferDate,
                amount,
                type: 'Debit',
                category: 'Transfer',
                description: notes || 'Money Transfer (Debit)',
                relatedEmployee: taker,
                referenceId: transfer._id
            }).save({ session });

            await new EmployeeLedger({
                employee: taker,
                date: transferDate,
                amount,
                type: 'Credit',
                category: 'Transfer',
                description: notes || 'Money Transfer (Credit)',
                relatedEmployee: giver,
                referenceId: transfer._id
            }).save({ session });
        }

        await session.commitTransaction();
        session.endSession();

        // ── WhatsApp Notifications (sent after commit, one-by-one with delay) ──
        // A 1.2-second gap between each message prevents WhatsApp from flagging
        // the account as spam, even for 10-15 receivers in a single bulk action.
        try {
            for (const item of transfers) {
                const { giver, taker, amount, date, notes } = item;
                try {
                    const [giverDoc, takerDoc] = await Promise.all([
                        EmployeeMaster.findById(giver).select('name phone'),
                        EmployeeMaster.findById(taker).select('name phone')
                    ]);

                    if (takerDoc && takerDoc.phone) {
                        const formattedDate = new Date(date || new Date()).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric'
                        });
                        const msg =
                            `💸 *Money Transfer Received!*\n\n` +
                            `*Sender:* *${giverDoc?.name || 'Employee'}*\n` +
                            `*Receiver:* *${takerDoc.name}*\n` +
                            `*Amount:* *₹${Number(amount).toLocaleString('en-IN')}*\n` +
                            `*Date:* ${formattedDate}` +
                            `\n\n_This is an automated notification from Unique Engineering._`;

                        await sendWhatsapp(takerDoc.phone, msg, req.user?.id);
                        // Wait 1.2s before next message to avoid spam detection
                        await delay(1200);
                    }
                } catch (individualErr) {
                    console.error(`[BulkTransfer] WhatsApp failed for taker ${taker} (non-critical):`, individualErr.message);
                    // Continue to next receiver even if one fails
                }
            }
        } catch (wpErr) {
            console.error('[BulkTransfer] WhatsApp loop error (non-critical):', wpErr.message);
        }
        // ────────────────────────────────────────────────────────────────────

        res.status(201).json({ success: true, message: 'Transfers recorded successfully' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('bulkCreateTransfers Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.deleteTransfer = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;
        const transfer = await EmployeeTransfer.findById(id);
        if (!transfer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Transfer not found' });
        }

        // Reverse Balances
        await EmployeeMaster.findByIdAndUpdate(transfer.giver, { $inc: { totalAmount: transfer.amount } }, { session });
        await EmployeeMaster.findByIdAndUpdate(transfer.taker, { $inc: { totalAmount: -transfer.amount } }, { session });

        // Delete Ledger Entries
        await EmployeeLedger.deleteMany({ referenceId: transfer._id }, { session });

        // Delete Transfer
        await EmployeeTransfer.findByIdAndDelete(id, { session });

        await session.commitTransaction();
        session.endSession();
        res.json({ success: true, message: 'Transfer deleted and balances reversed' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateTransfer = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id } = req.params;
        const { giver, taker, amount, date } = req.body;

        const oldTransfer = await EmployeeTransfer.findById(id);
        if (!oldTransfer) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Transfer not found' });
        }

        // 1. Reverse old balances
        await EmployeeMaster.findByIdAndUpdate(oldTransfer.giver, { $inc: { totalAmount: oldTransfer.amount } }, { session });
        await EmployeeMaster.findByIdAndUpdate(oldTransfer.taker, { $inc: { totalAmount: -oldTransfer.amount } }, { session });

        // 2. Update transfer record
        const updatedTransfer = await EmployeeTransfer.findByIdAndUpdate(id, {
            giver, taker, amount, date: date || oldTransfer.date
        }, { new: true, session });

        // 3. Apply new balances
        await EmployeeMaster.findByIdAndUpdate(giver, { $inc: { totalAmount: -amount } }, { session });
        await EmployeeMaster.findByIdAndUpdate(taker, { $inc: { totalAmount: amount } }, { session });

        // 4. Update ledger entries
        await EmployeeLedger.deleteMany({ referenceId: updatedTransfer._id }, { session });
        
        const transferDate = date ? new Date(date) : new Date(updatedTransfer.date);
        await new EmployeeLedger({
            employee: giver,
            date: transferDate,
            amount,
            type: 'Debit',
            category: 'Transfer',
            description: 'Money Transfer (Updated)',
            relatedEmployee: taker,
            referenceId: updatedTransfer._id
        }).save({ session });

        await new EmployeeLedger({
            employee: taker,
            date: transferDate,
            amount,
            type: 'Credit',
            category: 'Transfer',
            description: 'Money Transfer (Updated)',
            relatedEmployee: giver,
            referenceId: updatedTransfer._id
        }).save({ session });

        await session.commitTransaction();
        session.endSession();
        res.json({ success: true, message: 'Transfer updated successfully', data: updatedTransfer });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getTransfers = async (req, res) => {
    try {
        const transfers = await EmployeeTransfer.find()
            .populate('giver', 'name')
            .populate('taker', 'name')
            .sort({ date: -1 });
        res.json({ success: true, data: transfers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
