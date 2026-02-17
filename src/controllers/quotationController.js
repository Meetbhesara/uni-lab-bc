const Quotation = require('../models/Quotation');
const Enquiry = require('../models/Enquiry');
// const sendEmail = require('../utils/sendEmail'); // Disabled as I don't have this file content
// const sendWhatsApp = require('../utils/sendWhatsApp'); // Disabled

const createQuotation = async (req, res) => {
    try {
        const { enquiryId, items, status, pdfPath, htmlContent, nextFollowUp, packaging, packagingGst } = req.body;

        if (!enquiryId) {
            return res.status(400).json({ msg: 'Enquiry ID is required' });
        }
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ msg: 'Items are required' });
        }

        const enquiry = await Enquiry.findById(enquiryId);
        if (!enquiry) {
            return res.status(404).json({ msg: 'Enquiry not found' });
        }

        enquiry.status = 'Processed';
        await enquiry.save();

        const newQuotation = new Quotation({
            enquiry: enquiryId,
            items,
            status: status || 'Pending',
            pdfPath,
            htmlContent,
            nextFollowUp,
            packaging: packaging || 0,
            packagingGst: packagingGst || 0
        });

        const saved = await newQuotation.save();
        res.json(saved);
        // Email/WhatsApp sending skipped in restoration
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getQuotations = async (req, res) => {
    try {
        const list = await Quotation.find()
            .populate({
                path: 'enquiry',
                // populate: { path: 'products.productId' } // Removed as Product/Schema might be inferred
            })
            .populate('items.product')
            .sort({ createdAt: -1 });
        res.json(list);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const updateQuotation = async (req, res) => {
    try {
        const { status, pdfPath, followUp, followUps, nextFollowUp } = req.body;
        const quotation = await Quotation.findById(req.params.id).populate('enquiry');

        if (!quotation) {
            return res.status(404).json({ msg: 'Quotation not found' });
        }

        if (nextFollowUp) quotation.nextFollowUp = nextFollowUp;
        if (status) quotation.status = status;
        if (pdfPath) quotation.pdfPath = pdfPath;

        if (followUp) {
            const { date, note } = followUp;
            if (date && note) {
                quotation.followUps.push({ date, note });
            }
        }
        if (followUps && Array.isArray(followUps)) {
            quotation.followUps = followUps;
        }

        const updated = await quotation.save();
        res.json(updated);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const deleteQuotation = async (req, res) => {
    try {
        const quotation = await Quotation.findById(req.params.id);
        if (!quotation) {
            return res.status(404).json({ msg: 'Quotation not found' });
        }
        await quotation.deleteOne();
        res.json({ msg: 'Quotation removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = { createQuotation, getQuotations, updateQuotation, deleteQuotation };
