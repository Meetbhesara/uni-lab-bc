const Quotation = require('../models/Quotation');
const Enquiry = require('../models/Enquiry');
const Counter = require('../models/Counter');

const getNextRefNo = async () => {
    const year = new Date().getFullYear();
    const counterId = `quotation_${year}`;

    const counter = await Counter.findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    const seq = String(counter.seq).padStart(6, '0');
    return `${seq}-${year}`;
};

const createQuotation = async (req, res) => {
    try {
        const { enquiryId, items, status, pdfPath, htmlContent, nextFollowUp, packaging, packagingGst, discount } = req.body;

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

        const refNo = await getNextRefNo();

        const newQuotation = new Quotation({
            enquiry: enquiryId,
            refNo,
            items,
            status: status || 'Pending',
            pdfPath,
            htmlContent,
            nextFollowUp,
            packaging: packaging || 0,
            packagingGst: packagingGst || 0,
            discount: discount || 0
        });

        const saved = await newQuotation.save();
        res.json(saved);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getQuotations = async (req, res) => {
    try {
        const list = await Quotation.find()
            .populate('enquiry')
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
        const { status, pdfPath, htmlContent, followUp, followUps, nextFollowUp } = req.body;
        const quotation = await Quotation.findById(req.params.id).populate('enquiry');

        if (!quotation) {
            return res.status(404).json({ msg: 'Quotation not found' });
        }

        if (nextFollowUp) quotation.nextFollowUp = nextFollowUp;
        if (status) quotation.status = status;
        if (pdfPath) quotation.pdfPath = pdfPath;
        if (htmlContent) quotation.htmlContent = htmlContent;

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
