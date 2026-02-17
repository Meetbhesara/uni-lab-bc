const Invoice = require('../models/Invoice');
const Quotation = require('../models/Quotation');
const Enquiry = require('../models/Enquiry');
const fs = require('fs');

// Create Invoice from Quotation
const createInvoiceFromQuotation = async (req, res) => {
    try {
        const { quotationId, invoiceNumber, invoiceDate, dueDate } = req.body;

        const quotation = await Quotation.findById(quotationId).populate('items.product');
        if (!quotation) {
            return res.status(404).json({ msg: 'Quotation not found' });
        }

        const newInvoice = new Invoice({
            quotation: quotationId,
            enquiry: quotation.enquiry,
            invoiceNumber: invoiceNumber || `INV-${Math.floor(Math.random() * 10000)}`,
            invoiceDate: invoiceDate || Date.now(),
            dueDate: dueDate,
            items: quotation.items.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.price,
                gst: item.gst
            })),
            packaging: quotation.packaging,
            status: 'Unpaid'
        });

        const savedInvoice = await newInvoice.save();
        res.json(savedInvoice);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// Get Invoices
const getInvoices = async (req, res) => {
    try {
        const invoices = await Invoice.find()
            .populate('quotation')
            .populate('enquiry')
            .sort({ createdAt: -1 });
        res.json(invoices);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// Generate Tally XML for an Invoice
const generateTallyXML = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).populate('enquiry').populate('items.product');
        if (!invoice) return res.status(404).json({ msg: 'Invoice not found' });

        const dateStr = invoice.invoiceDate.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

        let xml = `<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
            </REQUESTDESC>
            <REQUESTDATA>
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
                        <DATE>${dateStr}</DATE>
                        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
                        <VOUCHERNUMBER>${invoice.invoiceNumber}</VOUCHERNUMBER>
                        <PARTYLEDGERNAME>${invoice.enquiry ? invoice.enquiry.Name : 'Unknown'}</PARTYLEDGERNAME>
                        <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
                        
                        <ALLLEDGERENTRIES.LIST>
                            <LEDGERNAME>${invoice.enquiry ? invoice.enquiry.Name : 'Unknown'}</LEDGERNAME>
                            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                            <AMOUNT>-${invoice.grandTotal}</AMOUNT>
                        </ALLLEDGERENTRIES.LIST>

                        ${invoice.items.map(item => `
                        <INVENTORYENTRIES.LIST>
                            <STOCKITEMNAME>${item.product.name}</STOCKITEMNAME>
                            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                            <RATE>${item.price}/Nos</RATE>
                            <AMOUNT>${item.price * item.quantity}</AMOUNT>
                            <ACTUALQTY> ${item.quantity} Nos</ACTUALQTY>
                            <BILLEDQTY> ${item.quantity} Nos</BILLEDQTY>
                        </INVENTORYENTRIES.LIST>
                        `).join('')}

                    </VOUCHER>
                </TALLYMESSAGE>
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>`;

        res.header('Content-Type', 'text/xml');
        res.attachment(`Tally_Invoice_${invoice.invoiceNumber}.xml`);
        res.send(xml);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

module.exports = {
    createInvoiceFromQuotation,
    getInvoices,
    generateTallyXML
};
