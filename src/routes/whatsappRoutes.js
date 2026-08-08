const express = require('express');
const router = express.Router();
const { sendWhatsapp, sendWhatsappMedia, getStatus, initialize, disconnect } = require('../utils/whatsappService');
const auth = require('../middlewares/auth');

// WhatsApp Session Management Routes
router.get('/status', auth, (req, res) => {
    const sessionId = req.query.sessionId || `admin_${req.user.id}`;
    const status = getStatus(sessionId);
    res.json(status);
});

router.post('/connect', auth, (req, res) => {
    const sessionId = req.body.sessionId || `admin_${req.user.id}`;
    const phoneNumber = req.body.phoneNumber || null;
    initialize(sessionId, 1, 3, phoneNumber);
    res.json({ success: true, msg: `Initializing session ${sessionId}` });
});

router.post('/disconnect', auth, async (req, res) => {
    const sessionId = req.body.sessionId || `admin_${req.user.id}`;
    await disconnect(sessionId);
    res.json({ success: true, msg: `Disconnected session ${sessionId}` });
});

const Quotation = require('../models/Quotation');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const puppeteer = require('puppeteer');

// Helper component: Ensure storage directory exists and generate full pdf on-the-fly
const STORAGE_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(STORAGE_DIR)) {
    console.log(`[STORAGE] Creating uploads directory at ${STORAGE_DIR}`);
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const generateQuotationPDF = async (htmlContent, outputPath) => {
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        // Log page errors or console triggers for debugging
        page.on('console', msg => console.log(`[Puppeteer Page] ${msg.text()}`));
        page.on('requestfailed', request => console.error(`[Puppeteer Request Failed] ${request.url()} - ${request.failure()?.errorText || 'Error'}`));

        await page.setContent(htmlContent, { waitUntil: 'load' });
        
        // Give it a delay to ensure images load
        await new Promise(resolve => setTimeout(resolve, 2500)); 

        await page.pdf({ 
            path: outputPath, 
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } 
        });
        
        await browser.close();
        return outputPath;
    } catch (e) {
        if (browser) await browser.close();
        throw e;
    }
};

router.post('/send-quotation', auth, async (req, res) => {
    try {
        const { logToFile } = require('../utils/whatsappService');
        const adminId = req.user?.id;
        
        console.log('\n--- [DEBUG] WhatsApp Quotation Request Received ---');
        logToFile('[DEBUG] WhatsApp Quotation Request Received', req.body);

        const { quotationId, phone, message, pdfUrl, pdfPath } = req.body;
        
        let targetPhone = phone;
        let targetPdf = pdfUrl || pdfPath;
        let targetMessage = message;

        if (quotationId) {
            console.log(`Looking up Quotation ID: ${quotationId}`);
            const quotation = await Quotation.findById(quotationId).populate('enquiry').populate('items.product');
            if (quotation && quotation.enquiry) {
                console.log(`Quotation Found!`);
                targetPhone = targetPhone || quotation.enquiry.phone;
                if (!targetMessage) {
                    targetMessage = `Hello ${quotation.enquiry.Name},\n\nHere is your quotation (Ref: ${quotation.refNo}) from Unique Lab Instrument.`;
                }
                
                // Always generate FRESH pdf from htmlContent
                if (quotation.htmlContent) {
                    const filename = `quotation_${quotation._id}.pdf`;
                    const absoluteOutPath = path.join(STORAGE_DIR, filename);
                    
                    console.log(`[Puppeteer] Generating on-the-fly PDF at: ${absoluteOutPath}`);
                    await generateQuotationPDF(quotation.htmlContent, absoluteOutPath);
                    targetPdf = `uploads/${filename}`; // Relative path for the sender
                    
                    // Save back into DB for future references
                    if (quotation.pdfPath !== targetPdf) {
                        quotation.pdfPath = targetPdf;
                        await quotation.save();
                    }
                } else if (!targetPdf) {
                    targetPdf = quotation.pdfPath;
                }
            }
        }

        console.log(`\nFinal Parameters for WhatsApp Post:`);
        logToFile('Final Parameters for WhatsApp Post', { targetPhone, targetPdf, message: targetMessage });

        if (!targetPhone) {
            console.error(`ERROR: Target phone string is EMPTY! Cannot send.`);
            return res.status(400).json({ success: false, error: 'Phone number is required or could not be fetched from the quotation.' });
        }

        if (!targetPdf) {
            console.error(`ERROR: PDF Path is empty for this quotation sending trigger.`);
            logToFile('Quotation Send ABORTED - PDF URL is empty');
            return res.status(400).json({ success: false, error: 'Cannot send quotation: The Quotation does not have a PDF file attached or passed in payload.' });
        }

        await sendWhatsappMedia(targetPhone, targetPdf, targetMessage, adminId);
        
        res.status(200).json({ success: true, msg: 'WhatsApp quotation sent!' });
    } catch (e) {
        console.error(`[DEBUG] Exception in /send-quotation handler:`, e);
        const { logToFile } = require('../utils/whatsappService');
        logToFile('[DEBUG] Exception in /send-quotation handler', { error: e.message, stack: e.stack });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/send-product', auth, async (req, res) => {
    try {
        const { phone, imageUrl, caption } = req.body;
        const adminId = req.user?.id;
        
        // Find or create user so they appear in the user table
        let user = await User.findOne({ phone });
        if (!user) {
            user = new User({
                email: `${phone}@gmail.com`,
                phone,
                name: 'WhatsApp Client'
            });
            await user.save();
        }

        if (imageUrl) {
            await sendWhatsappMedia(phone, imageUrl, caption, null);
        } else {
            await sendWhatsapp(phone, caption, null);
        }
        res.status(200).json({ success: true, msg: 'WhatsApp product sent!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const User = require('../models/User');
const Enquiry = require('../models/Enquiry');

router.post('/send-multiple-products', auth, async (req, res) => {
    try {
        const { phone, companyName, contactPersonName, email, products } = req.body;
        const adminId = req.user?.id;

        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }
        
        let targetEmail = email;
        if (!targetEmail) {
            targetEmail = `${phone}@gmail.com`;
        }
        
        // 1. Find or create user
        let user = await User.findOne({ phone });
        if (!user) user = await User.findOne({ email: targetEmail.toLowerCase() });
        
        if (!user) {
            user = new User({
                email: targetEmail.toLowerCase(),
                phone,
                companyName: companyName || '',
                contactPersonName: contactPersonName || '',
                name: contactPersonName || companyName || 'Client'
            });
            await user.save();
        } else {
            // Update user details if they were missing
            let updated = false;
            if (companyName && !user.companyName) { user.companyName = companyName; updated = true; }
            if (contactPersonName && !user.contactPersonName) { user.contactPersonName = contactPersonName; updated = true; }
            if (updated) await user.save();
        }

        // 2. Create WhatsApp Enquiry Log (type: 'whatsapp')
        const enquiryProducts = products.map(p => ({
            productId: p._id || p.id,
            quantity: 1,
            price: p.price || 0
        }));

        const defaultFollowUp = new Date();
        defaultFollowUp.setDate(defaultFollowUp.getDate() + 2); // default 2 days

        const enquiry = new Enquiry({
            Name: companyName || contactPersonName || 'Guest',
            companyName,
            contactPersonName,
            email: targetEmail,
            phone,
            products: enquiryProducts,
            type: 'whatsapp',
            status: 'Pending',
            isSeen: true, // Auto-seen since it's an outbound log
            firstFollowUpDate: defaultFollowUp,
            nextFollowUp: defaultFollowUp
        });
        await enquiry.save();

        // 3. Send WhatsApp Messages
        // We will send an intro message, followed by product messages
        let introMsg = `Hello ${contactPersonName || companyName || 'there'},\n\nHere are the products you requested from Unique Lab Instrument:\n\n`;
        await sendWhatsapp(phone, introMsg, null);
        
        // Add a small delay so messages arrive in order
        const delay = ms => new Promise(res => setTimeout(res, ms));

        for (const prod of products) {
            await delay(1500); // 1.5s delay between messages to avoid rate limit or out-of-order delivery
            
            const caption = `🚀 *${prod.name?.toUpperCase()}*\n\n` +
                            `📦 *Category:* ${prod.category || 'General'}\n\n` +
                            `📝 *Description:*\n${prod.description || 'No description provided'}\n\n` +
                            `🌐 *View on Website:* https://uniquenas.tail57739c.ts.net/product/${prod._id}`;
                            
            const imgPath = prod.localImages?.[0] || prod.images?.[0] || prod.photos?.[0];
            
            if (imgPath) {
                try {
                    await sendWhatsappMedia(phone, imgPath, caption, null);
                } catch (mediaErr) {
                    console.error('[WhatsApp] Failed to send media, falling back to text:', mediaErr.message);
                    await sendWhatsapp(phone, caption, null);
                }
            } else {
                await sendWhatsapp(phone, caption, null);
            }
        }
        
        await delay(1000);
        await sendWhatsapp(phone, `Please let us know if you have any questions or would like a formal quotation.\n\nThank you!`, null);

        res.status(200).json({ success: true, msg: 'WhatsApp products sent successfully!', enquiry });
    } catch (e) {
        console.error(`[DEBUG] Exception in /send-multiple-products:`, e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
