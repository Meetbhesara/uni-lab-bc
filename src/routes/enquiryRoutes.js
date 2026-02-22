const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');

// Create enquiry
router.post('/', async (req, res) => {
    try {
        const enquiry = new Enquiry(req.body);
        await enquiry.save();
        res.json(enquiry);
    } catch (e) { res.status(500).send('Error'); }
});

// Get all enquiries with populated product details
router.get('/', async (req, res) => {
    try {
        const enquiries = await Enquiry.find()
            .populate('products.productId', 'name images photos image')
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
