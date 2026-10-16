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
        
        if (typeof data.bankDetails === 'string') {
            try {
                data.bankDetails = JSON.parse(data.bankDetails);
            } catch (e) {}
        }
        
        const docFields = ['logo', 'udyamDoc', 'panCardDoc', 'gstDoc', 'cancelledChequeDoc', 'companyStamp'];
        let otherDocsList = [];
        if (data.existingOtherDocs) {
            try {
                otherDocsList = typeof data.existingOtherDocs === 'string' ? JSON.parse(data.existingOtherDocs) : data.existingOtherDocs;
            } catch (e) {}
        }

        if (req.files) {
            const folderName = data.companyName?.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'unknown';
            
            // Single fixed documents
            docFields.forEach(field => {
                if (req.files[field] && req.files[field].length > 0) {
                    const file = req.files[field][0];
                    data[field] = `/uploads/company_master/${folderName}/${file.filename}`;
                }
            });

            // Multiple other documents
            const newOtherDocFiles = [
                ...(req.files['otherDoc'] || []),
                ...(req.files['otherDocs'] || [])
            ];

            if (newOtherDocFiles.length > 0) {
                let titles = [];
                if (data.otherDocTitles) {
                    try {
                        titles = typeof data.otherDocTitles === 'string' ? JSON.parse(data.otherDocTitles) : data.otherDocTitles;
                    } catch (e) {
                        titles = [data.otherDocTitles];
                    }
                }
                newOtherDocFiles.forEach((file, idx) => {
                    const docTitle = (titles && titles[idx]) || data.otherDocTitle?.trim() || file.originalname || 'Other Document';
                    const fileUrl = `/uploads/company_master/${folderName}/${file.filename}`;
                    otherDocsList.push({
                        title: docTitle,
                        url: fileUrl,
                        uploadedAt: new Date()
                    });
                    data.otherDoc = fileUrl;
                    data.otherDocTitle = docTitle;
                });
            }
        }

        data.otherDocs = otherDocsList;

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
            } catch (e) {}
        }

        const existingCompany = await CompanyMaster.findById(id);
        if (!existingCompany) return res.status(404).json({ success: false, message: 'Company not found' });

        const docFields = ['logo', 'udyamDoc', 'panCardDoc', 'gstDoc', 'cancelledChequeDoc', 'companyStamp'];
        
        // Handle document removal flags
        docFields.forEach(field => {
            if (data[`remove_${field}`] === 'true' || data[`remove_${field}`] === true) {
                data[field] = null;
            }
        });

        // Initialize otherDocs from existing record or incoming payload
        let otherDocsList = Array.isArray(existingCompany.otherDocs) ? [...existingCompany.otherDocs] : [];
        
        // Migrate legacy otherDoc if not in otherDocsList yet
        if (existingCompany.otherDoc && !otherDocsList.some(d => d.url === existingCompany.otherDoc)) {
            otherDocsList.unshift({
                title: existingCompany.otherDocTitle || 'Other Document',
                url: existingCompany.otherDoc,
                uploadedAt: existingCompany.updatedAt || new Date()
            });
        }

        if (data.existingOtherDocs !== undefined) {
            try {
                otherDocsList = typeof data.existingOtherDocs === 'string' ? JSON.parse(data.existingOtherDocs) : data.existingOtherDocs;
            } catch (e) {}
        }

        // Handle specific remove by id
        if (data.remove_otherDoc_id) {
            otherDocsList = otherDocsList.filter(d => String(d._id) !== String(data.remove_otherDoc_id));
        }
        // Handle specific remove by url
        if (data.remove_otherDoc_url) {
            otherDocsList = otherDocsList.filter(d => d.url !== data.remove_otherDoc_url);
        }
        // Handle specific remove by index
        if (data.remove_otherDoc_index !== undefined) {
            const idx = parseInt(data.remove_otherDoc_index, 10);
            if (!isNaN(idx) && idx >= 0 && idx < otherDocsList.length) {
                otherDocsList.splice(idx, 1);
            }
        }
        if (data.remove_otherDoc === 'true' || data.remove_otherDoc === true) {
            data.otherDoc = null;
            data.otherDocTitle = '';
        }

        if (req.files) {
            const folderName = (data.companyName || existingCompany.companyName)?.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'unknown';
            
            // Single fixed documents
            docFields.forEach(field => {
                if (req.files[field] && req.files[field].length > 0) {
                    const file = req.files[field][0];
                    data[field] = `/uploads/company_master/${folderName}/${file.filename}`;
                }
            });

            // MULTIPLE OTHER DOCUMENTS: Append without overwriting!
            const newOtherDocFiles = [
                ...(req.files['otherDoc'] || []),
                ...(req.files['otherDocs'] || [])
            ];

            if (newOtherDocFiles.length > 0) {
                let titles = [];
                if (data.otherDocTitles) {
                    try {
                        titles = typeof data.otherDocTitles === 'string' ? JSON.parse(data.otherDocTitles) : data.otherDocTitles;
                    } catch (e) {
                        titles = [data.otherDocTitles];
                    }
                }
                newOtherDocFiles.forEach((file, idx) => {
                    const docTitle = (titles && titles[idx]) || data.otherDocTitle?.trim() || file.originalname || 'Other Document';
                    const fileUrl = `/uploads/company_master/${folderName}/${file.filename}`;
                    otherDocsList.push({
                        title: docTitle,
                        url: fileUrl,
                        uploadedAt: new Date()
                    });
                    data.otherDoc = fileUrl;
                    data.otherDocTitle = docTitle;
                });
            }
        }

        data.otherDocs = otherDocsList;

        const updatedCompany = await CompanyMaster.findByIdAndUpdate(id, data, { new: true });
        res.status(200).json({ success: true, message: 'Company updated successfully', data: updatedCompany });
    } catch (error) {
        console.error('Error updating company:', error);
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
