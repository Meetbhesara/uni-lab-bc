const fs = require('fs');
const path = require('path');

/**
 * Duplicates Topography Survey site files to backup storage (/volume1/WORK/SURVEY or NAS_BACKUP_PATH).
 * Only executes if:
 * 1. File path is a site file (contains 'client_master')
 * 2. Schedule type contains 'topography' / 'topo'
 */
const duplicateTopographySiteFile = (filePath, scheduleType) => {
    if (!filePath) return;

    // 1. Must be a site file (path contains client_master)
    const isSiteFile = filePath.includes('client_master');
    if (!isSiteFile) return;

    // 2. Must be a Topography Survey schedule
    const schedTypeStr = String(scheduleType || '').toLowerCase();
    const isTopography = schedTypeStr.includes('topography') || schedTypeStr.includes('topo');
    if (!isTopography) return;

    try {
        let backupBase = process.env.NAS_BACKUP_PATH || '/app/storage_backup';

        // Normalize slashes for comparison and replacement
        const normFilePath = filePath.replace(/\\/g, '/');
        let backupFilePath = '';

        if (normFilePath.includes('/client_master/')) {
            const relSubPath = normFilePath.substring(normFilePath.indexOf('/client_master/'));
            backupFilePath = path.join(backupBase, relSubPath);
        } else {
            return;
        }

        // Create target directory if it does not exist
        const backupDir = path.dirname(backupFilePath);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // Copy file to backup NAS (/volume1/WORK/SURVEY)
        fs.copyFileSync(filePath, backupFilePath);
        console.log(`✅ [TOPOGRAPHY BACKUP] Duplicated site file to backup NAS: ${backupFilePath}`);
    } catch (err) {
        console.error('❌ [TOPOGRAPHY BACKUP ERROR] Failed to duplicate file:', err.message);
    }
};

module.exports = { duplicateTopographySiteFile };
