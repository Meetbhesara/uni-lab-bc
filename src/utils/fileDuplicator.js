const fs = require('fs');
const path = require('path');

/**
 * Duplicates Topography Survey site files to backup storage (/volume1/WORK/LANDLAND SURVEY ( UNIQUE ENGINEERING )/APP WORK PROJECTS or NAS_BACKUP_PATH).
 * 
 * Rules:
 * 1. Must be a site file (path contains 'client_master')
 * 2. Schedule type must be Topography Survey (contains 'topography' or 'topo')
 * 3. ONLY backup files from:
 *    - data (raw / collected survey data files) -> mapped to 'data' folder in backup
 *    - Daily_report / dailyReports / report -> mapped to 'report' folder in backup
 *    - Mail / mail / mailFiles -> mapped to 'mail' folder in backup
 * 4. EXCLUDED from backup (NEVER created or copied):
 *    - photos / photo
 *    - drawing / drafting / convertedFiles / liningDrawFiles / esurveyWorkFiles
 * 5. Destination folders are ONLY created if the source file exists and is actually copied.
 */
const duplicateTopographySiteFile = (filePath, scheduleType, explicitCategory = null) => {
    if (!filePath) return;

    // Normalize slashes
    const normFilePath = String(filePath).replace(/\\/g, '/');

    // 1. Must be a site file (path contains client_master)
    if (!normFilePath.includes('/client_master/')) return;

    // 2. Must be a Topography Survey schedule
    const schedTypeStr = String(scheduleType || '').toLowerCase();
    const isTopography = schedTypeStr.includes('topography') || schedTypeStr.includes('topo');
    if (!isTopography) return;

    // 3. Determine target backup subfolder: ONLY 'data', 'report', 'mail'
    let targetSubfolder = null;

    if (explicitCategory) {
        const cat = String(explicitCategory).toLowerCase();
        if (cat === 'data' || cat === 'collectedfiles') targetSubfolder = 'data';
        else if (cat === 'daily_report' || cat === 'dailyreports' || cat === 'report') targetSubfolder = 'report';
        else if (cat === 'mail' || cat === 'mailfiles') targetSubfolder = 'mail';
    } else {
        if (normFilePath.includes('/data/')) targetSubfolder = 'data';
        else if (normFilePath.includes('/daily_report/') || normFilePath.includes('/dailyreports/') || normFilePath.includes('/report/')) targetSubfolder = 'report';
        else if (normFilePath.includes('/mail/') || normFilePath.includes('/mailfiles/')) targetSubfolder = 'mail';
        else if (normFilePath.includes('/collectedfiles/')) targetSubfolder = 'data';
    }

    // If it's photos, drawing, or anything else not in [data, report, mail], DO NOT BACKUP
    if (!targetSubfolder) {
        return;
    }

    try {
        const backupBase = process.env.NAS_BACKUP_PATH || '/app/storage_backup';

        // Extract client and site path: e.g. client_master/[clientId]/site_master/[siteSubfolder]
        const clientMasterIndex = normFilePath.indexOf('/client_master/');
        const afterClientMaster = normFilePath.substring(clientMasterIndex + '/client_master/'.length);
        const segments = afterClientMaster.split('/');

        if (segments.length < 3) {
            return;
        }

        const clientId = segments[0];
        const siteSubfolder = segments[2];
        const fileName = path.basename(normFilePath);

        // Build exact backup file path
        const backupFilePath = path.join(backupBase, 'client_master', clientId, 'site_master', siteSubfolder, targetSubfolder, fileName);

        const doCopy = () => {
            try {
                if (fs.existsSync(filePath)) {
                    const backupDir = path.dirname(backupFilePath);
                    if (!fs.existsSync(backupDir)) {
                        fs.mkdirSync(backupDir, { recursive: true });
                    }
                    fs.copyFileSync(filePath, backupFilePath);
                    console.log(`✅ [TOPOGRAPHY BACKUP] Successfully copied to ${targetSubfolder}: ${backupFilePath}`);
                }
            } catch (err) {
                console.error('❌ [TOPOGRAPHY BACKUP ERROR] Copy failed:', err.message);
            }
        };

        if (fs.existsSync(filePath)) {
            doCopy();
        } else {
            // In case file is currently being flushed by Multer
            setTimeout(doCopy, 400);
        }
    } catch (err) {
        console.error('❌ [TOPOGRAPHY BACKUP ERROR] Failed to process duplication:', err.message);
    }
};

module.exports = { duplicateTopographySiteFile };
