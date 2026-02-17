const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');

// Basic Controller Logic inline or minimal
router.post('/', async (req, res) => {
    try {
        const enquiry = new Enquiry(req.body);
        await enquiry.save();
        res.json(enquiry);
    } catch (e) { res.status(500).send('Error'); }
});

router.get('/', async (req, res) => {
    try {
        const enquiries = await Enquiry.find().sort({ createdAt: -1 });
        res.json(enquiries);
    } catch (e) { res.status(500).send('Error'); }
});

module.exports = router;
