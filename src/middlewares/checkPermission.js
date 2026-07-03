const User = require('../models/User');

const PARENT_PERMISSIONS = {
    // Products
    'showStock': 'products',
    'showSellingPrice': 'products',
    'showDealerPrice': 'products',
    'showVendors': 'products',

    // Enquiries
    'incomingEnquiries': 'enquiries',
    'outboundQuotations': 'enquiries',
    'processedHistory': 'enquiries',

    // Vehicle Master
    'vehicleMaster_form': 'vehicleMaster',
    'vehicleMaster_view': 'vehicleMaster',

    // Employee Master
    'employeeMaster_form': 'employeeMaster',
    'employeeMaster_view': 'employeeMaster',
    'employeeMaster_payment': 'employeeMaster',
    'employeeMaster_adminReport': 'employeeMaster',

    // Client Master
    'clientMaster_form': 'clientMaster',
    'clientMaster_view': 'clientMaster',

    // Site Master
    'siteMaster_form': 'siteMaster',
    'siteMaster_view': 'siteMaster',

    // Schedule Master
    'scheduleMaster_form': 'scheduleMaster',
    'scheduleMaster_view': 'scheduleMaster',
    'scheduleMaster_report': 'scheduleMaster',

    // Instrument Master
    'instrumentMaster_form': 'instrumentMaster',
    'instrumentMaster_view': 'instrumentMaster',
    'instrumentMaster_groups': 'instrumentMaster',

    // Employee Expense
    'employeeExpense_transfer': 'employeeExpense',
    'employeeExpense_daily': 'employeeExpense',
    'employeeExpense_report': 'employeeExpense',
    
    'employeeExpense_transfer_create': 'employeeExpense_transfer',
    'employeeExpense_transfer_view': 'employeeExpense_transfer',
    'employeeExpense_transfer_attendance': 'employeeExpense_transfer',

    // Daily Report Sub-modules
    'employeeExpense_report_last5days': 'employeeExpense_report',
    'employeeExpense_report_advanced': 'employeeExpense_report',

    // Other Services Sub-modules
    'draftingWork': 'otherServices',
    'invoiceReport': 'otherServices'
};

const checkPermission = (moduleName, action = 'read') => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            // Retrieve user with permissions from DB
            const dbUser = await User.findById(req.user.id || req.user._id);
            if (!dbUser) {
                return res.status(401).json({ success: false, message: 'User not found' });
            }

            // Super Admin gets unrestricted access
            if (dbUser.isSuperAdmin) {
                return next();
            }

            // Non-admin users don't have these permissions
            if (!dbUser.isAdmin) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }

            // Legacy admins without a permissions object default to true so we don't break existing setups
            if (!dbUser.permissions) {
                return next();
            }

            // Recursive helper function to check permission and parent permissions
            const hasPerm = (userPerms, modName) => {
                // If parent permission exists, check it first
                const parentKey = PARENT_PERMISSIONS[modName];
                if (parentKey) {
                    if (!hasPerm(userPerms, parentKey)) {
                        return false;
                    }
                }
                const perm = userPerms[modName];
                if (!perm) return false;
                return perm[action] === true;
            };

            if (hasPerm(dbUser.permissions, moduleName)) {
                return next();
            }

            return res.status(403).json({ success: false, message: `Access denied: missing ${action} permission for ${moduleName}` });
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({ success: false, message: 'Internal server error during permission check' });
        }
    };
};

module.exports = checkPermission;
