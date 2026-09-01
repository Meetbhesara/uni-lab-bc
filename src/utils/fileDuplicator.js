const fs = require('fs');
const path = require('path');
const { getSiteMasterPath } = require('./pathHelper');

/**
 * Duplicates Topography Survey site files to backup storage (/volume1/WORK/LANDLAND SURVEY ( UNIQUE ENGINEERING )/APP WORK PROJECTS or NAS_BACKUP_PATH).
 * Only backups to 3 folders: 'data', 'report', 'mail'.
 */
const duplicateTopographySiteFile = (filePath, scheduleType, explicitCategory = null) => {
    if (!filePath) return;

    const normFilePath = String(filePath).replace(/\\/g, '/');
    const lowerNormPath = normFilePath.toLowerCase();

    // 1. Must be a site file (path contains client_master)
    if (!lowerNormPath.includes('/client_master/')) return;

    // 2. Schedule type check (if provided, must be topography/topo/land survey or site work)
    if (scheduleType) {
        const schedTypeStr = String(scheduleType).toLowerCase();
        const isTopography = schedTypeStr.includes('topography') || schedTypeStr.includes('topo') || schedTypeStr.includes('survey');
        if (!isTopography) return;
    }

    let targetSubfolder = null;
    if (explicitCategory) {
        const cat = String(explicitCategory).toLowerCase();
        if (cat === 'data' || cat === 'collectedfiles') targetSubfolder = 'data';
        else if (cat === 'daily_report' || cat === 'dailyreports' || cat === 'report') targetSubfolder = 'report';
        else if (cat === 'mail' || cat === 'mailfiles') targetSubfolder = 'mail';
    }

    if (!targetSubfolder) {
        if (lowerNormPath.includes('/data/') || lowerNormPath.includes('/collectedfiles/')) {
            targetSubfolder = 'data';
        } else if (lowerNormPath.includes('/daily_report/') || lowerNormPath.includes('/dailyreports/') || lowerNormPath.includes('/report/')) {
            targetSubfolder = 'report';
        } else if (lowerNormPath.includes('/mail/') || lowerNormPath.includes('/mailfiles/')) {
            targetSubfolder = 'mail';
        }
    }

    // Strictly skip photos, drawings, and other categories
    if (!targetSubfolder) {
        console.log(`[TOPOGRAPHY BACKUP] Skipped non-backup category for: ${normFilePath}`);
        return;
    }

    try {
        const backupBase = process.env.NAS_BACKUP_PATH || '/app/storage_backup';

        const clientMasterIndex = lowerNormPath.indexOf('/client_master/');
        const afterClientMaster = normFilePath.substring(clientMasterIndex + '/client_master/'.length);
        const segments = afterClientMaster.split('/');

        if (segments.length < 3) return;

        const clientId = segments[0];
        const siteSubfolder = segments[2];
        const fileName = path.basename(normFilePath);

        // Resolve target directory on NAS backup
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
                } else {
                    console.warn(`⚠️ [TOPOGRAPHY BACKUP] Source file not found yet: ${filePath}`);
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

module.exports = { duplicateTopographySiteFile };
