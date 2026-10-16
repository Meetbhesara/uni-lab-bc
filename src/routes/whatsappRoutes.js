const Catalog = require('../models/Catalog');
const express = require('express');
const router = express.Router();
const { sendWhatsapp, sendWhatsappMedia, getStatus, initialize, disconnect } = require('../utils/whatsappService');
const auth = require('../middlewares/auth');
const { addToGoogleContacts, isValidRealEmail } = require('../utils/googleContacts');

// WhatsApp Session Management Routes
router.get('/status', auth, (req, res) => {
    let sessionId = req.query.sessionId;
    if (sessionId && sessionId !== 'system_default' && !sessionId.startsWith('admin_')) sessionId = `admin_${sessionId}`;
    if (!sessionId) sessionId = `admin_${req.user.id}`;
    const status = getStatus(sessionId);
    res.json(status);
});

router.post('/connect', auth, (req, res) => {
    let sessionId = req.body.sessionId;
    if (sessionId && sessionId !== 'system_default' && !sessionId.startsWith('admin_')) sessionId = `admin_${sessionId}`;
    if (!sessionId) sessionId = `admin_${req.user.id}`;
    const phoneNumber = req.body.phoneNumber || null;
    initialize(sessionId, 1, 3, phoneNumber);
    res.json({ success: true, msg: `Initializing session ${sessionId}` });
});

router.post('/disconnect', auth, async (req, res) => {
    let sessionId = req.body.sessionId;
    if (sessionId && sessionId !== 'system_default' && !sessionId.startsWith('admin_')) sessionId = `admin_${sessionId}`;
    if (!sessionId) sessionId = `admin_${req.user.id}`;
    await disconnect(sessionId);
    res.json({ success: true, msg: `Disconnected session ${sessionId}` });
});

const Quotation = require('../models/Quotation');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const { generatePDFFromHTML } = require('../utils/pdfGenerator');

const generateQuotationPDF = async (htmlContent, outputPath) => {
    return await generatePDFFromHTML(htmlContent, outputPath, {
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });
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
                    targetMessage = `Hello ${quotation.enquiry.Name},\n\nHere is your quotation (Ref: ${quotation.refNo}) from Unique Engineering.`;
                }

                // Always generate FRESH pdf from htmlContent
                if (quotation.htmlContent) {
                    const filename = `quotation_${quotation._id}.pdf`;
                    const STORAGE_DIR = process.env.LOCAL_BASE_PATH || path.join(process.cwd(), 'uploads');
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

        let whatsappSent = false;
        let whatsappError = null;
        try {
            await sendWhatsappMedia(targetPhone, targetPdf, targetMessage, adminId);
            whatsappSent = true;
        } catch (wErr) {
            console.error('[WhatsApp Quotation Send Error]:', wErr.message);
            logToFile('Quotation Send WhatsApp Media Error', { error: wErr.message });
            whatsappError = wErr.message;
        }

        // Auto-save User to MongoDB & Sync to Google Contacts (with deduplication)
        const cleanPhone = (targetPhone || '').replace(/\D/g, '');
        let quotationDocEnquiry = null;
        if (quotationId) {
            try {
                const qDoc = await Quotation.findById(quotationId).populate('enquiry');
                if (qDoc && qDoc.enquiry) quotationDocEnquiry = qDoc.enquiry;
            } catch (_) {}
        }

        const clientName = (quotationDocEnquiry && (quotationDocEnquiry.contactPersonName || quotationDocEnquiry.Name || quotationDocEnquiry.companyName)) || req.body.clientName || 'Quotation Client';
        const companyName = (quotationDocEnquiry && quotationDocEnquiry.companyName) || req.body.companyName || '';
        const contactPersonName = (quotationDocEnquiry && (quotationDocEnquiry.contactPersonName || quotationDocEnquiry.Name)) || '';
        const targetEmail = (quotationDocEnquiry && quotationDocEnquiry.email && isValidRealEmail(quotationDocEnquiry.email)) ? quotationDocEnquiry.email.trim().toLowerCase() : '';
        const gstNumber = (quotationDocEnquiry && quotationDocEnquiry.gstNumber) || req.body.gstNumber || '';
        const address = (quotationDocEnquiry && quotationDocEnquiry.address) || req.body.address || '';

        let googleContactResult = { success: false, reason: 'Not attempted' };
        if (cleanPhone && cleanPhone.length >= 10) {
            try {
                let user = await User.findOne({ phone: cleanPhone });
                if (!user && targetEmail) user = await User.findOne({ email: targetEmail });
                if (!user) {
                    user = new User({
                        phone: cleanPhone,
                        email: targetEmail || `${cleanPhone}@noemail.com`,
                        name: clientName,
                        companyName,
                        contactPersonName,
                        gstNumber,
                        address
                    });
                    await user.save();
                } else {
                    let updated = false;
                    if (companyName && !user.companyName) { user.companyName = companyName; updated = true; }
                    if (contactPersonName && !user.contactPersonName) { user.contactPersonName = contactPersonName; updated = true; }
                    if (gstNumber && !user.gstNumber) { user.gstNumber = gstNumber; updated = true; }
                    if (address && !user.address) { user.address = address; updated = true; }
                    if (targetEmail && (!user.email || user.email.includes('noemail'))) { user.email = targetEmail; updated = true; }
                    if (updated) await user.save();
                }
            } catch (uErr) {
                console.warn('[User Sync on Quotation Send]:', uErr.message);
            }

            // Sync to Google Contacts (awaited - result returned to frontend for acknowledgement)
            try {
                googleContactResult = await addToGoogleContacts({
                    name: clientName,
                    phone: cleanPhone,
                    email: targetEmail || undefined,
                    company: companyName,
                    address: address,
                    gstNumber: gstNumber,
                    username: cleanPhone.slice(-8),
                    source: 'WhatsApp Quotation Share'
                });
            } catch (gcErr) {
                console.error('[Google Contacts Quotation Share Error]:', gcErr.message);
                googleContactResult = { success: false, error: gcErr.message };
            }
        }

        res.status(200).json({ 
            success: true, 
            msg: 'WhatsApp quotation sent & contact synced to Google Contacts!',
            clientName,
            companyName,
            phone: cleanPhone,
            googleContactResult
        });
    } catch (e) {
        console.error(`[DEBUG] Exception in /send-quotation handler:`, e);
        const { logToFile } = require('../utils/whatsappService');
        logToFile('[DEBUG] Exception in /send-quotation handler', { error: e.message, stack: e.stack });
        res.status(500).json({ success: false, error: e.message });
    }
});

const User = require('../models/User');
const Enquiry = require('../models/Enquiry');
const Product = require('../models/Product');

// Helper to build rich, all-in-one product caption with specifications & direct link
const buildRichProductCaption = async ({ prod, clientName, index = 0, total = 1 }) => {
    let fullProd = prod;
    const prodId = prod._id || prod.id;
    if ((!prod.details || Object.keys(prod.details).length === 0) && prodId) {
        try {
            const dbP = await Product.findById(prodId);
            if (dbP) fullProd = dbP;
        } catch (_) {}
    }

    const greeting = (index === 0 && clientName)
        ? `Hello *${clientName}*, 👋\n\nThank you for connecting with *Unique Lab Instrument*!\n\nPlease find the instrument details below:\n\n`
        : '';

    const name = (fullProd.name || prod.name || 'Testing Instrument').trim();
    const category = (fullProd.category || prod.category || '').trim();
    const targetId = fullProd._id || fullProd.id || prodId || '';
    const directLink = category ? `https://uecivil.com/products?category=${encodeURIComponent(category)}&highlight=${targetId}` : `https://uecivil.com/products?highlight=${targetId}`;

    // Format Specifications from fullProd.details
    let specsLines = [];
    if (fullProd.details) {
        let d = fullProd.details;
        if (typeof d === 'string') {
            try { d = JSON.parse(d); if (typeof d === 'string') d = JSON.parse(d); } catch (_) {}
        }
        if (Array.isArray(d)) {
            d.forEach(item => {
                if (item && item.key && item.value) {
                    specsLines.push(`  • *${item.key.trim()}:* ${String(item.value).trim()}`);
                }
            });
        } else if (d && typeof d === 'object') {
            const entries = d instanceof Map ? Array.from(d.entries()) : Object.entries(d);
            entries.forEach(([key, val]) => {
                if (key && key !== '_id' && val !== undefined && val !== null && String(val).trim() !== '') {
                    const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    specsLines.push(`  • *${key.trim()}:* ${strVal.trim()}`);
                }
            });
        }
    }

    let specsText = '';
    if (specsLines.length > 0) {
        specsText = `\n⚙️ *Key Specifications:*\n` + specsLines.slice(0, 8).join('\n') + '\n';
    }

    // Format Description
    let descText = '';
    const rawDesc = (fullProd.description || prod.description || '').trim();
    if (rawDesc && rawDesc !== 'No description provided') {
        const cleanDesc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + '...' : rawDesc;
        descText = `\n📝 *Description:*\n${cleanDesc}\n`;
    }

    const caption = `${greeting}🔬 *${name.toUpperCase()}*\n` +
                    (category ? `📦 *Category:* ${category}\n` : '') +
                    specsText +
                    descText +
                    `\n🔗 *View & Inquire on Website:*\n${directLink}\n\n` +
                    `✅ *Quality Assured by Unique Lab Instrument*\n` +
                    `🌐 *Official Website:* https://uecivil.com`;

    return caption;
};


router.post('/send-product', auth, async (req, res) => {
    try {
        const { phone, imageUrl, caption, companyName, contactPersonName, email, gstNumber, address, clientAddress, product, productId } = req.body;
        const adminId = req.user?.id;
        const clientAddr = (address || clientAddress || '').trim();

        // 1. Find or create/update user in MongoDB (overwriting fields when provided)
        let user = await User.findOne({ phone });
        if (!user) {
            user = new User({
                email: email ? email.toLowerCase() : `${phone}@gmail.com`,
                phone,
                name: contactPersonName || companyName || 'WhatsApp Client',
                companyName: (companyName || '').trim(),
                contactPersonName: (contactPersonName || '').trim(),
                gstNumber: (gstNumber || '').trim().toUpperCase(),
                address: clientAddr
            });
            await user.save();
        } else {
            let updated = false;
            if (companyName && companyName.trim() && user.companyName !== companyName.trim()) { 
                user.companyName = companyName.trim(); 
                updated = true; 
            }
            if (contactPersonName && contactPersonName.trim() && user.contactPersonName !== contactPersonName.trim()) { 
                user.contactPersonName = contactPersonName.trim(); 
                user.name = contactPersonName.trim(); 
                updated = true; 
            }
            if (gstNumber && gstNumber.trim() && user.gstNumber !== gstNumber.trim().toUpperCase()) { 
                user.gstNumber = gstNumber.trim().toUpperCase(); 
                updated = true; 
            }
            if (clientAddr && clientAddr.trim() && user.address !== clientAddr.trim()) { 
                user.address = clientAddr.trim(); 
                updated = true; 
            }
            if (email && isValidRealEmail(email) && user.email !== email.trim().toLowerCase()) { 
                user.email = email.trim().toLowerCase(); 
                updated = true; 
            }
            if (updated) await user.save();
        }

        // 2 & 3. Swift Parallel Execution: WhatsApp Dispatch + Google Contacts Sync concurrently
        const singleClientName = (contactPersonName && contactPersonName.trim()) 
            || (companyName && companyName.trim()) 
            || (user && (user.contactPersonName || user.name)) 
            || 'WhatsApp Client';
        const singleEmail = (email && isValidRealEmail(email)) ? email : (user && user.email && isValidRealEmail(user.email) ? user.email : '');
        const cleanPhone = (phone || '').replace(/\D/g, '');
        const clientUsername = (req.body.username || contactPersonName || companyName || (user && user.contactPersonName) || (user && user.name) || cleanPhone.slice(-8)).trim();

        const [waResult, googleContactResult] = await Promise.all([
            (async () => {
                let sent = false;
                let err = null;
                try {
                    let finalCaption = caption;
                    const targetProd = product || (productId ? { _id: productId } : null);
                    if (targetProd) {
                        finalCaption = await buildRichProductCaption({
                            prod: targetProd,
                            clientName: (contactPersonName || companyName || '').trim(),
                            index: 0,
                            total: 1
                        });
                    }

                    if (imageUrl) {
                        await sendWhatsappMedia(phone, imageUrl, finalCaption, adminId);
                    } else {
                        await sendWhatsapp(phone, finalCaption, adminId);
                    }
                    sent = true;
                } catch (waErr) {
                    console.error('[WhatsApp Single Product Send Error]:', waErr.message);
                    err = waErr.message;
                }
                return { sent, err };
            })(),
            (async () => {
                try {
                    return await addToGoogleContacts({
                        name: singleClientName,
                        phone: phone,
                        email: singleEmail,
                        company: companyName || (user && user.companyName) || '',
                        address: clientAddr || (user && user.address) || '',
                        gstNumber: gstNumber || (user && user.gstNumber) || '',
                        username: clientUsername,
                        source: 'WhatsApp Single Product'
                    });
                } catch (gcErr) {
                    console.error('[Google Contacts WhatsApp Send Error]:', gcErr.message);
                    return { success: false, error: gcErr.message };
                }
            })()
        ]);

        const whatsappSent = waResult.sent;
        const whatsappError = waResult.err;

        res.status(200).json({ 
            success: true, 
            whatsappSent,
            whatsappError,
            msg: whatsappSent ? 'WhatsApp product sent!' : `Product processed (WhatsApp not sent: ${whatsappError})`, 
            googleContactResult 
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/send-multiple-products', auth, async (req, res) => {
    try {
        const { phone, companyName, contactPersonName, email, gstNumber, address, clientAddress, products } = req.body;
        const adminId = req.user?.id;
        const clientAddr = (address || clientAddress || '').trim();

        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }

        let targetEmail = email;
        if (!targetEmail) {
            targetEmail = `${phone}@gmail.com`;
        }

        // 1. Find or create/update user in MongoDB (overwriting fields when provided)
        let user = await User.findOne({ phone });
        if (!user) user = await User.findOne({ email: targetEmail.toLowerCase() });

        if (!user) {
            user = new User({
                email: targetEmail.toLowerCase(),
                phone,
                companyName: (companyName || '').trim(),
                contactPersonName: (contactPersonName || '').trim(),
                gstNumber: (gstNumber || '').trim().toUpperCase(),
                address: clientAddr,
                name: contactPersonName || companyName || 'Client'
            });
            await user.save();
        } else {
            let updated = false;
            if (companyName && companyName.trim() && user.companyName !== companyName.trim()) { 
                user.companyName = companyName.trim(); 
                updated = true; 
            }
            if (contactPersonName && contactPersonName.trim() && user.contactPersonName !== contactPersonName.trim()) { 
                user.contactPersonName = contactPersonName.trim(); 
                user.name = contactPersonName.trim(); 
                updated = true; 
            }
            if (gstNumber && gstNumber.trim() && user.gstNumber !== gstNumber.trim().toUpperCase()) { 
                user.gstNumber = gstNumber.trim().toUpperCase(); 
                updated = true; 
            }
            if (clientAddr && clientAddr.trim() && user.address !== clientAddr.trim()) { 
                user.address = clientAddr.trim(); 
                updated = true; 
            }
            if (email && isValidRealEmail(email) && user.email !== email.trim().toLowerCase()) { 
                user.email = email.trim().toLowerCase(); 
                updated = true; 
            }
            if (updated) await user.save();
        }

        // 2 & 4. Swift Parallel Execution: WhatsApp Dispatch + Google Contacts Sync concurrently
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const cleanPhone = (phone || '').replace(/\D/g, '');
        const clientName = (contactPersonName && contactPersonName.trim()) 
            || (companyName && companyName.trim()) 
            || 'WhatsApp Client';
        const cleanEmail = (targetEmail && isValidRealEmail(targetEmail)) ? targetEmail : ((email && isValidRealEmail(email)) ? email : '');
        const clientUsername = (req.body.username || contactPersonName || companyName || (user && user.contactPersonName) || (user && user.name) || cleanPhone.slice(-8)).trim();

        console.log('[WhatsApp] Swift sending messages to ' + phone + ' (' + (products ? products.length : 0) + ' products)');

        const [waResult, googleContactResult] = await Promise.all([
            (async () => {
                let sent = false;
                let err = null;
                try {
                    if (Array.isArray(products) && products.length > 0) {
                        for (let i = 0; i < products.length; i++) {
                            const prod = products[i];
                            if (i > 0) await delay(500); // 500ms swift delay between products

                            const caption = await buildRichProductCaption({
                                prod,
                                clientName: (contactPersonName || companyName || '').trim(),
                                index: i,
                                total: products.length
                            });

                            const imgPath = prod.localImages?.[0] || prod.images?.[0] || prod.photos?.[0];

                            if (imgPath) {
                                try {
                                    await sendWhatsappMedia(phone, imgPath, caption, adminId);
                                } catch (mediaErr) {
                                    console.warn('[WhatsApp] Media failed, falling back to text:', mediaErr.message);
                                    await sendWhatsapp(phone, caption, adminId);
                                }
                            } else {
                                await sendWhatsapp(phone, caption, adminId);
                            }
                        }
                    }
                    console.log('[WhatsApp] All product messages sent successfully (All-In-One per product) to ' + phone);
                    sent = true;
                } catch (whatsappErr) {
                    err = whatsappErr.message || 'WhatsApp send failed';
                    console.error('[WhatsApp] Send failed for ' + phone + ':', err);
                }
                return { sent, err };
            })(),
            (async () => {
                try {
                    return await addToGoogleContacts({
                        name: clientName,
                        phone: phone,
                        email: cleanEmail,
                        company: companyName || '',
                        address: clientAddr || (user && user.address) || '',
                        gstNumber: gstNumber || (user && user.gstNumber) || '',
                        username: clientUsername,
                        source: 'WhatsApp Product Share'
                    });
                } catch (gcErr) {
                    console.error('[Google Contacts WhatsApp Sync Error]:', gcErr.message);
                    return { success: false, error: gcErr.message };
                }
            })()
        ]);

        const whatsappSent = waResult.sent;
        const sendError = waResult.err;

        // 3. Create the WhatsApp log entry in DB
        let enquiry = null;
        try {
            const enquiryProducts = Array.isArray(products) ? products.map(p => ({
                productId: p._id || p.id,
                quantity: 1,
                price: p.price || 0
            })) : [];

            const defaultFollowUp = new Date();
            defaultFollowUp.setDate(defaultFollowUp.getDate() + 2);

            enquiry = new Enquiry({
                Name: companyName || contactPersonName || 'Guest',
                companyName: companyName || '',
                contactPersonName: contactPersonName || '',
                email: targetEmail,
                phone,
                gstNumber: gstNumber || (user && user.gstNumber) || '',
                address: clientAddr || (user && user.address) || '',
                products: enquiryProducts,
                type: 'whatsapp',
                status: 'Pending',
                isSeen: true,
                firstFollowUpDate: defaultFollowUp,
                nextFollowUp: defaultFollowUp,
                whatsappStatus: whatsappSent ? 'sent' : 'failed',
                whatsappSentAt: whatsappSent ? new Date() : null
            });
            await enquiry.save();
        } catch (enqDbErr) {
            console.warn('[WhatsApp Multi] Could not create enquiry log:', enqDbErr.message);
        }

        res.status(200).json({ 
            success: true, 
            whatsappSent,
            whatsappError: sendError,
            msg: whatsappSent ? 'WhatsApp products sent successfully!' : `Products processed (WhatsApp not sent: ${sendError})`, 
            enquiry, 
            googleContactResult 
        });
    } catch (e) {
        console.error(`[DEBUG] Exception in /send-multiple-products:`, e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/send-invoice', auth, async (req, res) => {
    try {
        const { phone, pdfUrl, invoiceId, invoiceType, clientName, billDate, dueDate, totalAmount, pendingAmount, sitesCovered, message, additionalFiles } = req.body;
        const adminId = req.user?.id;

        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone number is required.' });
        }

        if (!pdfUrl && (!additionalFiles || additionalFiles.length === 0)) {
            return res.status(400).json({ success: false, error: 'No PDF or document file specified.' });
        }

        const isProforma = invoiceType === 'proforma' || invoiceType === 'PROFORMA';
        const typeLabel = isProforma ? 'Proforma Invoice' : 'Tax Invoice';

        // Construct a cool, rich, formatted WhatsApp payment reminder message
        let coolReminderMsg = message;
        if (!coolReminderMsg) {
            coolReminderMsg = `🔔 *PAYMENT REMINDER & INVOICE DETAILS*\n\n` +
                `Hello *${clientName || 'Valued Client'}*,\n\n` +
                `Greetings from *Unique Engineering*! 👋\n\n` +
                `Here are the details for your *${typeLabel}*:\n` +
                `------------------------------------\n` +
                `📄 *Invoice No:* ${invoiceId || 'N/A'}\n` +
                (billDate ? `📅 *Bill Date:* ${billDate}\n` : '') +
                (dueDate ? `⏰ *Due Date:* ${dueDate}\n` : '') +
                (sitesCovered ? `📍 *Sites Covered:* ${sitesCovered}\n` : '') +
                (totalAmount ? `💰 *Total Amount:* ₹${Number(totalAmount).toLocaleString('en-IN')}\n` : '') +
                (pendingAmount ? `🔴 *Pending Balance:* ₹${Number(pendingAmount).toLocaleString('en-IN')}\n` : '') +
                `------------------------------------\n\n` +
                `📎 *Please find attached your Invoice PDF & Site Documents below.*\n\n` +
                `Kindly review the documents and process the pending payment at your earliest convenience.\n\n` +
                `If you have already made the payment, please disregard this message.\n\n` +
                `Thank you for your business! 🙏\n` +
                `*Unique Engineering*`;
        }

        console.log("[WhatsApp] Sending payment reminder & invoice " + (invoiceId || '') + " to " + phone + " via admin session admin_" + adminId);

        // 1. Send the text message first
        await sendWhatsapp(phone, coolReminderMsg, adminId);

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        await delay(1500);

        // 2. Send the PDF attachment
        if (pdfUrl) {
            const pdfCaption = `📄 *Attached PDF:* ${typeLabel} (${invoiceId || ''})`;
            await sendWhatsappMedia(phone, pdfUrl, pdfCaption, adminId);
        }

        // 3. Send additional selected site documents if provided
        if (Array.isArray(additionalFiles) && additionalFiles.length > 0) {
            for (const fileUrl of additionalFiles) {
                if (fileUrl) {
                    await delay(1200);
                    const fileName = fileUrl.split('/').pop() || 'Document';
                    await sendWhatsappMedia(phone, fileUrl, "📄 Attachment: " + fileName, adminId);
                }
            }
        }

        // Automatic Google Contacts Sync for Invoice recipient
        if (phone) {
            const cleanInvoicePhone = phone.replace(/\D/g, '');
            if (cleanInvoicePhone.length >= 10) {
                addToGoogleContacts({
                    name: clientName || 'Invoice Client',
                    phone: cleanInvoicePhone,
                    source: 'WhatsApp Invoice Share'
                }).catch(err => {
                    console.error('[Google Contacts Invoice Share Error]:', err.message);
                });
            }
        }

        res.status(200).json({ success: true, msg: "WhatsApp payment reminder message, PDF and documents sent successfully!" });
    } catch (e) {
        console.error("[WhatsApp] Exception in /send-invoice handler:", e);
        res.status(500).json({ success: false, error: e.message || 'Failed to send WhatsApp message' });
    }
});


router.post('/send-catalog', auth, async (req, res) => {
    try {
        const {
            phone,
            companyName,
            contactPersonName,
            email,
            gstNumber,
            address,
            catalogId,
            catalogIds,
            pdfUrl,
            pdfUrls,
            catalogTitle,
            catalogTitles,
            message
        } = req.body;
        const adminId = req.user?.id;

        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone number is required.' });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ success: false, error: 'Valid 10-digit phone number is required.' });
        }

        // 1. Gather all files and titles to send
        let filesToSend = [];
        let titlesToSend = [];

        if (Array.isArray(pdfUrls) && pdfUrls.length > 0) {
            filesToSend = [...pdfUrls];
        } else if (pdfUrl) {
            filesToSend = [pdfUrl];
        }

        if (Array.isArray(catalogTitles) && catalogTitles.length > 0) {
            titlesToSend = [...catalogTitles];
        } else if (catalogTitle) {
            titlesToSend = [catalogTitle];
        }

        // If catalogId or catalogIds provided, fetch from Catalog collection
        const idList = [
            ...(Array.isArray(catalogIds) ? catalogIds : []),
            ...(catalogId ? [catalogId] : [])
        ].filter(Boolean);

        if (idList.length > 0 && filesToSend.length === 0) {
            const fetchedCatalogs = await Catalog.find({ _id: { $in: idList } });
            fetchedCatalogs.forEach(c => {
                if (c.pdfUrl && !filesToSend.includes(c.pdfUrl)) {
                    filesToSend.push(c.pdfUrl);
                    titlesToSend.push(c.title);
                }
            });
        }

        if (filesToSend.length === 0) {
            return res.status(400).json({ success: false, error: 'No catalog files found to send.' });
        }

        // 2. Find or Create/Update User in MongoDB (overwriting fields when provided)
        let targetEmail = (email && isValidRealEmail(email)) ? email.trim().toLowerCase() : `${cleanPhone}@noemail.com`;
        let user = await User.findOne({ phone: cleanPhone });
        if (!user && isValidRealEmail(targetEmail)) {
            user = await User.findOne({ email: targetEmail });
        }

        const clientName = (contactPersonName && contactPersonName.trim()) 
            || (companyName && companyName.trim()) 
            || 'Catalog Client';

        if (!user) {
            user = new User({
                phone: cleanPhone,
                email: targetEmail,
                name: clientName,
                companyName: (companyName || '').trim(),
                contactPersonName: (contactPersonName || '').trim(),
                gstNumber: (gstNumber || '').trim().toUpperCase(),
                address: (address || '').trim()
            });
            await user.save();
        } else {
            let updated = false;
            if (companyName && companyName.trim() && user.companyName !== companyName.trim()) { 
                user.companyName = companyName.trim(); 
                updated = true; 
            }
            if (contactPersonName && contactPersonName.trim() && user.contactPersonName !== contactPersonName.trim()) { 
                user.contactPersonName = contactPersonName.trim(); 
                user.name = contactPersonName.trim(); 
                updated = true; 
            }
            if (gstNumber && gstNumber.trim() && user.gstNumber !== gstNumber.trim().toUpperCase()) { 
                user.gstNumber = gstNumber.trim().toUpperCase(); 
                updated = true; 
            }
            if (address && address.trim() && user.address !== address.trim()) { 
                user.address = address.trim(); 
                updated = true; 
            }
            if (isValidRealEmail(email) && user.email !== email.trim().toLowerCase()) {
                user.email = email.trim().toLowerCase();
                updated = true;
            }
            if (updated) await user.save();
        }

        // 3. Create Enquiry log
        try {
            const enquiry = new Enquiry({
                Name: companyName || contactPersonName || 'Catalog Client',
                companyName: companyName || '',
                contactPersonName: contactPersonName || '',
                email: targetEmail,
                phone: cleanPhone,
                products: [],
                type: 'whatsapp',
                status: 'Pending',
                isSeen: true,
                notes: `Catalog Share: ${titlesToSend.join(', ') || 'Product Catalog'}`
            });
            await enquiry.save();
        } catch (enqErr) {
            console.warn('[WhatsApp] Could not save enquiry log:', enqErr.message);
        }

        // 4 & 5. Swift Parallel Execution: WhatsApp Dispatch + Google Contacts Sync concurrently
        const clientUsername = (req.body.username || contactPersonName || companyName || (user && user.contactPersonName) || (user && user.name) || cleanPhone.slice(-8)).trim();

        const [waResult, googleContactResult] = await Promise.all([
            // WhatsApp Dispatch Flow: ALL-IN-ONE Media Message (Text + Image combined, no separate text)
            (async () => {
                let sent = false;
                let err = null;
                try {
                    const titlesText = titlesToSend.length > 0 
                        ? titlesToSend.map((t, idx) => `📖 *${idx + 1}. ${t}*`).join('\n') 
                        : '📖 *Official Product Catalog*';

                    const allInOneCaption = (message && message.trim()) 
                        ? message.trim() 
                        : `Hello *${contactPersonName || companyName || 'Valued Client'}*, 👋\n\n` +
                          `Thank you for connecting with *Unique Lab Instrument*!\n\n` +
                          `Please find our technical brochure & catalog attached below:\n` +
                          `${titlesText}\n\n` +
                          `✅ *Quality Assured Laboratory & Survey Instruments*\n` +
                          `🌐 *Official Website:* https://uecivil.com\n\n` +
                          `Best Regards,\n` +
                          `*Unique Lab Instrument*`;

                    console.log(`[WhatsApp] Sending All-In-One Catalog message to ${cleanPhone} (Website: https://uecivil.com)`);

                    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

                    if (filesToSend.length > 0) {
                        for (let i = 0; i < filesToSend.length; i++) {
                            const fileUrl = filesToSend[i];
                            const title = titlesToSend[i] || path.basename(fileUrl);
                            if (i > 0) await delay(350);

                            const isPdf = fileUrl.toLowerCase().includes('.pdf');
                            // FIRST FILE gets the FULL GREETING CAPTION (All-In-One image + text message!)
                            // Subsequent files get title + website link
                            const caption = (i === 0) 
                                ? allInOneCaption 
                                : (isPdf ? `📄 *${title}*\n🌐 https://uecivil.com` : `🖼️ *${title}*\n🌐 https://uecivil.com`);

                            await sendWhatsappMedia(cleanPhone, fileUrl, caption, adminId);
                        }
                    } else {
                        // Fallback only if no files attached
                        await sendWhatsapp(cleanPhone, allInOneCaption, adminId);
                    }
                    sent = true;
                } catch (waErr) {
                    console.error('[WhatsApp Catalog Send Error]:', waErr.message);
                    err = waErr.message;
                }
                return { sent, err };
            })(),

            // Google Contacts Sync Flow (runs at the exact same moment)
            (async () => {
                try {
                    return await addToGoogleContacts({
                        name: clientName,
                        phone: cleanPhone,
                        email: isValidRealEmail(email) ? email : undefined,
                        company: companyName || (user && user.companyName) || '',
                        address: address || (user && user.address) || '',
                        gstNumber: gstNumber || (user && user.gstNumber) || '',
                        username: clientUsername,
                        source: 'WhatsApp Catalog Share'
                    });
                } catch (gcErr) {
                    console.error('[Google Contacts Catalog Share Error]:', gcErr.message);
                    return { success: false, error: gcErr.message };
                }
            })()
        ]);

        const whatsappSent = waResult.sent;
        const whatsappError = waResult.err;

        res.status(200).json({
            success: true,
            whatsappSent,
            whatsappError,
            msg: whatsappSent 
                ? `Catalog(s) sent successfully via WhatsApp to ${cleanPhone} & client synced to Google Contacts!`
                : `Catalog processed (WhatsApp not sent: ${whatsappError}) & client synced to Google Contacts!`,
            user,
            googleContactResult
        });
    } catch (e) {
        console.error('[WhatsApp] Exception in /send-catalog handler:', e);
        res.status(500).json({ success: false, error: e.message || 'Failed to send catalog on WhatsApp' });
    }
});

module.exports = router;
