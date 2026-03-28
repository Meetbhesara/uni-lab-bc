const express = require('express');
const router = express.Router();
const { sendWhatsapp, sendWhatsappMedia } = require('../utils/whatsappService');

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

router.post('/send-quotation', async (req, res) => {
    try {
        const { logToFile } = require('../utils/whatsappService');
        
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

        await sendWhatsappMedia(targetPhone, targetPdf, targetMessage);
        
        res.status(200).json({ success: true, msg: 'WhatsApp quotation sent!' });
    } catch (e) {
        console.error(`[DEBUG] Exception in /send-quotation handler:`, e);
        const { logToFile } = require('../utils/whatsappService');
        logToFile('[DEBUG] Exception in /send-quotation handler', { error: e.message, stack: e.stack });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/send-product', async (req, res) => {
    try {
        const { phone, imageUrl, caption } = req.body;
        if (imageUrl) {
            await sendWhatsappMedia(phone, imageUrl, caption);
        } else {
            await sendWhatsapp(phone, caption);
        }
        res.status(200).json({ success: true, msg: 'WhatsApp product sent!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
