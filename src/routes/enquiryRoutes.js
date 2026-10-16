const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');
const User = require('../models/User');
const Cart = require('../models/Cart');
const { addToGoogleContacts } = require('../utils/googleContacts');

// Create enquiry
router.post('/', async (req, res) => {
    try {
        const { companyName, contactPersonName, phone, email, gstNumber, address, clientAddress, products, type, status } = req.body;

        // 1. Mandatory Validation check
        if (!companyName && !contactPersonName) {
            return res.status(400).json({ msg: 'Company Name or Contact Person Name is required' });
        }
        if (!phone || !email) {
            return res.status(400).json({ msg: 'Phone and Email are required' });
        }

        const clientAddr = (address || clientAddress || '').trim();

        // 2. Find or Create User
        let user = await User.findByEmail(email);
        
        // --- NEW: Restrict if found user is an Admin ---
        if (user && user.isAdmin) {
            return res.status(400).json({ msg: 'Cannot process enquiry using administrative email accounts' });
        }

        if (!user) {
            user = new User({
                email: email.toLowerCase(),
                phone,
                companyName: companyName || '',
                contactPersonName: contactPersonName || '',
                gstNumber: gstNumber || '',
                address: clientAddr,
                name: contactPersonName || companyName || 'Client'
            });
            await user.save();
        } else {
            let updated = false;
            if (clientAddr && !user.address) { user.address = clientAddr; updated = true; }
            if (gstNumber && !user.gstNumber) { user.gstNumber = gstNumber; updated = true; }
            if (companyName && !user.companyName) { user.companyName = companyName; updated = true; }
            if (contactPersonName && !user.contactPersonName) { user.contactPersonName = contactPersonName; updated = true; }
            if (updated) await user.save();
        }

        // 3. Create Enquiry
        const enquiry = new Enquiry({
            Name: companyName || contactPersonName || 'Guest',
            companyName,
            contactPersonName,
            gstNumber,
            address: clientAddr,
            email,
            phone,
            products,
            type: type || 'enquiry',
            status: status || 'Pending'
        });
        await enquiry.save();

        // 5. Automatic Google Contacts Sync (with duplicate check, address, GST & EU-username)
        const clientName = (contactPersonName && contactPersonName.trim()) 
            || (companyName && companyName.trim()) 
            || (req.body.Name && req.body.Name.trim())
            || 'Enquiry Client';

        const cleanPhone = (phone || '').replace(/\D/g, '');
        const clientUsername = req.body.username || contactPersonName || companyName || req.body.Name || (cleanPhone ? cleanPhone.slice(-8) : '');

        let googleContactResult = { success: false, reason: 'Not attempted' };
        try {
            googleContactResult = await addToGoogleContacts({
                name: clientName,
                phone: phone,
                email: email,
                company: companyName || '',
                address: clientAddr || (user && user.address) || '',
                gstNumber: gstNumber || (user && user.gstNumber) || '',
                username: clientUsername,
                source: 'Product Enquiry'
            });
        } catch (err) {
            console.error('[Google Contacts Error in Enquiry]:', err.message);
            googleContactResult = { success: false, error: err.message };
        }

        // 4. Clear ALL cart documents related to this enquiry
        const { sessionId } = req.body;
        const deleteConditions = [];

        // Delete by the user we found/created via email
        if (user && user._id) {
            deleteConditions.push({ userId: user._id });
        }

        // Delete by phone (covers cases where user registered by phone and cart linked to that userId)
        if (req.body.phone) {
            try {
                const phoneUser = await User.findOne({ phone: req.body.phone });
                if (phoneUser && phoneUser._id) {
                    // Only add if not already covered
                    const alreadyCovered = deleteConditions.some(c => c.userId && c.userId.toString() === phoneUser._id.toString());
                    if (!alreadyCovered) {
                        deleteConditions.push({ userId: phoneUser._id });
                    }
                }
            } catch (_) { /* silent */ }
        }

        // Delete by sessionId (guest carts)
        if (sessionId) {
            deleteConditions.push({ sessionId: sessionId });
        }

        if (deleteConditions.length > 0) {
            await Cart.deleteMany({ $or: deleteConditions });
        }

        res.json({ ...enquiry.toObject(), googleContactResult });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error processing enquiry');
    }
});


// Dashboard fast-stats: counts only using MongoDB aggregation, no full documents
router.get('/stats', async (req, res) => {
    try {
        const [total, unseen] = await Promise.all([
            Enquiry.countDocuments(),
            Enquiry.countDocuments({ isSeen: false })
        ]);
        res.json({ success: true, total, unseen });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/enquiries - paginated, filterable by type & search
// Query params:
//   type     = 'enquiry' | 'whatsapp'  (required for tab separation)
//   page     = 1, 2, ...               (default: 1)
//   limit    = 20                      (default: 20, max: 100)
//   search   = text                    (searches Name, phone, email)
router.get('/', async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 20);
        const skip  = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const typeFilter = req.query.type; // 'enquiry' or 'whatsapp'

        // Build filter
        const filter = {};
        if (typeFilter) {
            filter.type = typeFilter;
        }
        if (search) {
            filter.$or = [
                { Name:  { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const [data, total] = await Promise.all([
            Enquiry.find(filter)
                .populate('products.productId')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Enquiry.countDocuments(filter)
        ]);

        res.json({
            data,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
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

// Update enquiry (e.g. status or details)
router.put('/:id', async (req, res) => {
    try {
        const enquiry = await Enquiry.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        if (!enquiry) return res.status(404).json({ msg: 'Enquiry not found' });

        // Update corresponding User in MongoDB if exists
        try {
            const userPhone = enquiry.phone;
            if (userPhone) {
                let user = await User.findOne({ phone: userPhone });
                if (user) {
                    let userUpdated = false;
                    if (req.body.companyName) { user.companyName = req.body.companyName; userUpdated = true; }
                    if (req.body.contactPersonName) { user.contactPersonName = req.body.contactPersonName; userUpdated = true; }
                    if (req.body.gstNumber) { user.gstNumber = req.body.gstNumber; userUpdated = true; }
                    if (req.body.address) { user.address = req.body.address; userUpdated = true; }
                    if (req.body.email) { user.email = req.body.email; userUpdated = true; }
                    if (userUpdated) await user.save();
                }
            }
        } catch (_) {}

        // Overwrite & Sync to Google Contacts
        let googleContactResult = { success: false, reason: 'No phone' };
        if (enquiry.phone) {
            const clientName = (req.body.contactPersonName || enquiry.contactPersonName || req.body.companyName || enquiry.companyName || enquiry.Name || 'Client').trim();
            const cleanPhone = (enquiry.phone || '').replace(/\D/g, '');
            const clientUsername = req.body.username || enquiry.contactPersonName || enquiry.companyName || cleanPhone.slice(-8);

            try {
                googleContactResult = await addToGoogleContacts({
                    name: clientName,
                    phone: enquiry.phone,
                    email: req.body.email || enquiry.email,
                    company: req.body.companyName || enquiry.companyName || '',
                    address: req.body.address || enquiry.address || '',
                    gstNumber: req.body.gstNumber || enquiry.gstNumber || '',
                    username: clientUsername,
                    source: 'Enquiry Update'
                });
            } catch (err) {
                console.error('[Google Contacts Error in Enquiry Update]:', err.message);
                googleContactResult = { success: false, error: err.message };
            }
        }

        res.json({ ...enquiry.toObject(), googleContactResult });
    } catch (e) { res.status(500).send('Error'); }
});

// Delete enquiry
router.delete('/:id', async (req, res) => {
    try {
        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ msg: 'Enquiry not found' });
        await enquiry.deleteOne();
        res.json({ msg: 'Enquiry removed' });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error removing enquiry');
    }
});

// Add Follow-up
router.post('/:id/follow-up', async (req, res) => {
    try {
        const { remark, nextFollowUpDate, addedBy, newStatus } = req.body;
        if (!remark || !nextFollowUpDate) {
            return res.status(400).json({ msg: 'Remark and next follow-up date are required' });
        }

        const enquiry = await Enquiry.findById(req.params.id);
        if (!enquiry) return res.status(404).json({ msg: 'Enquiry not found' });

        enquiry.followUps.push({
            remark,
            nextFollowUpDate: new Date(nextFollowUpDate),
            addedBy: addedBy || 'Admin',
            addedAt: new Date()
        });

        enquiry.nextFollowUp = new Date(nextFollowUpDate);

        if (newStatus && ['Pending', 'Pass', 'Reject', 'Sent', 'Done'].includes(newStatus)) {
            enquiry.status = newStatus;
        }

        await enquiry.save();
        res.json({ msg: 'Follow-up added successfully', enquiry });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
