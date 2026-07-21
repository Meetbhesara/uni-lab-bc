const CompanyMaster = require('../models/CompanyMaster');
const path = require('path');
const fs = require('fs');

const getCompanies = async (req, res) => {
    try {
        const companies = await CompanyMaster.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: companies });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const storeCompany = async (req, res) => {
    try {
        const data = req.body;
        
        // Parse bank details if sent as JSON string
        if (typeof data.bankDetails === 'string') {
            try {
                data.bankDetails = JSON.parse(data.bankDetails);
            } catch (e) {
                // Ignore parse errors
            }
        }
        
        if (req.files && req.files.logo && req.files.logo.length > 0) {
            const file = req.files.logo[0];
            const urlPath = `/uploads/company_master/${data.companyName?.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'unknown'}/${file.filename}`;
            data.logo = urlPath;
        }

        const newCompany = new CompanyMaster(data);
        await newCompany.save();

        res.status(201).json({ success: true, message: 'Company created successfully', data: newCompany });
    } catch (error) {
        console.error('Error storing company:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCompany = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        if (typeof data.bankDetails === 'string') {
            try {
                data.bankDetails = JSON.parse(data.bankDetails);
            } catch (e) {
                // Ignore
            }
        }

        if (req.files && req.files.logo && req.files.logo.length > 0) {
            const file = req.files.logo[0];
            const urlPath = `/uploads/company_master/${data.companyName?.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'unknown'}/${file.filename}`;
            data.logo = urlPath;
        }

        const updatedCompany = await CompanyMaster.findByIdAndUpdate(id, data, { new: true });
        if (!updatedCompany) return res.status(404).json({ success: false, message: 'Company not found' });

        res.status(200).json({ success: true, message: 'Company updated successfully', data: updatedCompany });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteCompany = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedCompany = await CompanyMaster.findByIdAndDelete(id);
        if (!deletedCompany) return res.status(404).json({ success: false, message: 'Company not found' });
        res.status(200).json({ success: true, message: 'Company deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getCompanies, storeCompany, updateCompany, deleteCompany };
