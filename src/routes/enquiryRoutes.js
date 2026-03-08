const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');
const User = require('../models/User');
const Cart = require('../models/Cart');
// Create enquiry
router.post('/', async (req, res) => {
    try {
        const { companyName, contactPersonName, phone, email, gstNumber, products, type, status } = req.body;

        // 1. Mandatory Validation check
        if (!companyName && !contactPersonName) {
            return res.status(400).json({ msg: 'Company Name or Contact Person Name is required' });
        }
        if (!phone || !email) {
            return res.status(400).json({ msg: 'Phone and Email are required' });
        }

        // 2. Find or Create User
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({
                email,
                phone,
                companyName: companyName || '',
                contactPersonName: contactPersonName || '',
                gstNumber: gstNumber || '',
                name: contactPersonName || companyName // Map base
            });
            await user.save();
        } else {
            // Update existing user with new details just in case
            if (companyName) user.companyName = companyName;
            if (contactPersonName) user.contactPersonName = contactPersonName;
            if (phone) user.phone = phone;
            if (gstNumber) user.gstNumber = gstNumber;
            user.name = contactPersonName || companyName || user.name;
            await user.save();
        }

        // 3. Create Enquiry
        const enquiry = new Enquiry({
            Name: companyName || contactPersonName || 'Guest',
            companyName,
            contactPersonName,
            gstNumber,
            email,
            phone,
            products,
            type: type || 'enquiry',
            status: status || 'Pending'
        });
        await enquiry.save();

        // 4. Clear the active cart
        const { sessionId } = req.body;
        const deleteConditions = [];
        if (user && user._id) {
            deleteConditions.push({ userId: user._id });
        }
        if (sessionId) {
            deleteConditions.push({ sessionId: sessionId });
        }

        if (deleteConditions.length > 0) {
            await Cart.deleteMany({ $or: deleteConditions });
        }

        res.json(enquiry);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error processing enquiry');
    }
});

// Get all enquiries with populated product details
router.get('/', async (req, res) => {
    try {
        const enquiries = await Enquiry.find()
            .populate('products.productId')
            .sort({ createdAt: -1 });
        res.json(enquiries);
    } catch (e) { res.status(500).send('Error'); }
});

// Mark enquiry as seen
router.patch('/:id/seen', async (req, res) => {
    try {
        const enquiry = await Enquiry.findByIdAndUpdate(
            req.params.id,
            { isSeen: true },
            { new: true }
        );
        if (!enquiry) return res.status(404).json({ msg: 'Enquiry not found' });
        res.json(enquiry);
    } catch (e) { res.status(500).send('Error'); }
});

module.exports = router;
