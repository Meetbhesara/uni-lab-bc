const Quotation = require('../models/Quotation');
const Enquiry = require('../models/Enquiry');
const Counter = require('../models/Counter');

const getNextRefNo = async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed (Jan=1, Apr=4)

    let startYear, endYear;
    // Indian Fiscal Year starts April 1st
    if (currentMonth < 4) {
        startYear = currentYear - 1;
        endYear = currentYear;
    } else {
        startYear = currentYear;
        endYear = currentYear + 1;
    }

    const fiscalYearStr = `${startYear}-${String(endYear).slice(-2)}`;
    const counterId = `quotation_${fiscalYearStr}`;

    const counter = await Counter.findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    const seq = String(counter.seq).padStart(4, '0');
    return `${fiscalYearStr} UL${seq}`;
};

const User = require('../models/User'); // Import User model

const createQuotation = async (req, res) => {
    try {
        const { 
            enquiryId, items, status, pdfPath, htmlContent, nextFollowUp, packaging, packagingGst, discount,
            partyName, contactPerson, email, phone, gstNumber // New party details for potential correction
        } = req.body;

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

        // --- Synchronize Party Details into Enquiry & User ---
        // If the admin edited party details in the quotation creation modal, apply them back
        if (partyName) {
            enquiry.companyName = partyName;
            enquiry.Name = partyName; // Primary display name
        }
        if (contactPerson) enquiry.contactPersonName = contactPerson;
        if (email) enquiry.email = email;
        if (phone) enquiry.phone = phone;
        if (gstNumber) enquiry.gstNumber = gstNumber;

        enquiry.status = 'Processed';
        await enquiry.save();

        // Also update or create the User record based on the email provided
        const finalEmail = email || enquiry.email;
        if (finalEmail && finalEmail !== 'N/A') {
            try {
                let user = await User.findOne({ email: finalEmail });
                if (user) {
                    if (partyName) user.companyName = partyName;
                    if (contactPerson) user.contactPersonName = contactPerson;
                    if (phone) user.phone = phone;
                    if (gstNumber) user.gstNumber = gstNumber;
                    user.name = contactPerson || partyName || user.name;
                    await user.save();
                } else if (phone && phone !== 'N/A') {
                    // Create minimal user if not exists
                    user = new User({
                        email: finalEmail,
                        phone: phone,
                        companyName: partyName || '',
                        contactPersonName: contactPerson || '',
                        name: contactPerson || partyName || 'Client',
                        gstNumber: gstNumber || ''
                    });
                    await user.save();
                }
            } catch (userErr) { console.error("Could not sync user during quotation", userErr); }
        }

        // --- Generate Reference Number (Check for Revisions) ---
        let refNo;
        const existingQuotes = await Quotation.find({ enquiry: enquiryId }).sort({ createdAt: 1 });
        
        if (existingQuotes.length > 0) {
            // It's a revision! Use the base ref from the first quotation
            const firstQuote = existingQuotes[0];
            // Split by '(' to get the base ref in case the first one somehow had a suffix
            const baseRef = firstQuote.refNo ? firstQuote.refNo.split('(')[0] : (await getNextRefNo());
            refNo = `${baseRef}(R${existingQuotes.length})`;
        } else {
            // First time quote for this enquiry
            refNo = await getNextRefNo();
        }

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
