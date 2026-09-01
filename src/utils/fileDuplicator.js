const fs = require('fs');
const path = require('path');
const { getSiteMasterPath } = require('./pathHelper');

/**
 * Duplicates Topography Survey site files to backup storage (/volume1/WORK/LANDLAND SURVEY ( UNIQUE ENGINEERING )/APP WORK PROJECTS or NAS_BACKUP_PATH).
 */
const duplicateTopographySiteFile = (filePath, scheduleType, explicitCategory = null) => {
    if (!filePath) return;

    const normFilePath = String(filePath).replace(/\\/g, '/');
    if (!normFilePath.includes('/client_master/')) return;

    const schedTypeStr = String(scheduleType || '').toLowerCase();
    const isTopography = schedTypeStr.includes('topography') || schedTypeStr.includes('topo');
    if (!isTopography) return;

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

    if (!targetSubfolder) return;

    try {
        const backupBase = process.env.NAS_BACKUP_PATH || '/app/storage_backup';

        const clientMasterIndex = normFilePath.indexOf('/client_master/');
        const afterClientMaster = normFilePath.substring(clientMasterIndex + '/client_master/'.length);
        const segments = afterClientMaster.split('/');

        if (segments.length < 3) return;

        const clientId = segments[0];
        const siteSubfolder = segments[2];
        const fileName = path.basename(normFilePath);

        // Resolve unified destination path on NAS backup
        const targetDir = getSiteMasterPath(backupBase, clientId, siteSubfolder, targetSubfolder);
        const backupFilePath = path.join(targetDir, fileName);

        const doCopy = () => {
            try {
                if (fs.existsSync(filePath)) {
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
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
            setTimeout(doCopy, 400);
        }
    } catch (err) {
        console.error('❌ [TOPOGRAPHY BACKUP ERROR] Failed to process duplication:', err.message);
    }
};

const deleteSiteFileFromDiskAndBackup = (fileUrlOrPath, fileName = null) => {
    // Kept as helper if ever needed, but user requested DB only removal
};

module.exports = { duplicateTopographySiteFile, deleteSiteFileFromDiskAndBackup };
