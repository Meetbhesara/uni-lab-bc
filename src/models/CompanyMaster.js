const mongoose = require('mongoose');

const bankDetailsSchema = new mongoose.Schema({
    accountHolderName: { type: String, trim: true },
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
});

const companyMasterSchema = new mongoose.Schema({
    companyName: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    udyamNumber: { type: String, trim: true },
    gstin: { type: String, trim: true },
    contactNo: { type: String, trim: true },
    email: { type: String, trim: true },
    bankDetails: { type: bankDetailsSchema, default: () => ({}) },
    panCardNumber: { type: String, trim: true },
    invoicePrefix: { type: String, trim: true }, // e.g. UE, ULI
    logo: { type: String }, // Path to uploaded logo
    udyamDoc: { type: String }, // Path to uploaded Udyam Registration PDF/Photo
    panCardDoc: { type: String }, // Path to uploaded PAN Card PDF/Photo
    gstDoc: { type: String }, // Path to uploaded GST Certificate PDF/Photo
    cancelledChequeDoc: { type: String }, // Path to uploaded Cancelled Cheque PDF/Photo
    companyStamp: { type: String } // Path to uploaded Company Stamp Photo/Image
}, { timestamps: true });

module.exports = mongoose.model('CompanyMaster', companyMasterSchema);
