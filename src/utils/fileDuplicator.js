const fs = require('fs');
const path = require('path');
const { getSiteMasterPath } = require('./pathHelper');

const LOG_PREFIX = '[TOPO-BACKUP]';

function logInfo(msg)  { console.log (new Date().toISOString() + ' INFO  ' + LOG_PREFIX + ' ' + msg); }
function logOk(msg)    { console.log (new Date().toISOString() + ' OK    ' + LOG_PREFIX + ' ' + msg); }
function logWarn(msg)  { console.warn(new Date().toISOString() + ' WARN  ' + LOG_PREFIX + ' ' + msg); }
function logError(msg) { console.error(new Date().toISOString() + ' ERROR ' + LOG_PREFIX + ' ' + msg); }
function logSkip(msg)  { console.log (new Date().toISOString() + ' SKIP  ' + LOG_PREFIX + ' ' + msg); }

/**
 * Duplicates Topography Survey site files to backup storage.
 *   Docker volume mapping:
 *     /app/storage_backup -> /volume1/WORK/LANDLAND SURVEY ( UNIQUE ENGINEERING )/APP WORK PROJECTS
 *
 * Backup categories: data, report, mail  (photos and drawings are skipped by design).
 */
const duplicateTopographySiteFile = (filePath, scheduleType, explicitCategory = null) => {
    if (!filePath) {
        logWarn('Called with empty filePath — skipping.');
        return;
    }

    const normFilePath = String(filePath).replace(/\\/g, '/');
    const lowerNormPath = normFilePath.toLowerCase();

    logInfo('─────────────────────────────────────────────────────────────');
    logInfo('Called for file      : ' + normFilePath);
    logInfo('Schedule type        : ' + (scheduleType || '(not provided)'));
    logInfo('Explicit category    : ' + (explicitCategory || '(auto-detect)'));

    // 1. Must be a site file (path contains client_master)
    if (!lowerNormPath.includes('/client_master/')) {
        logSkip('File is not under client_master — not a site file.');
        return;
    }

    // 2. Schedule type check — only TOPOGRAPHY SURVEY triggers backup
    if (scheduleType) {
        const schedTypeStr = String(scheduleType).toLowerCase();
        const isTopography = schedTypeStr.includes('topography') ||
                             schedTypeStr.includes('topo') ||
                             schedTypeStr.includes('survey');
        if (!isTopography) {
            logSkip('Schedule type "' + scheduleType + '" is not a Topography Survey — backup not needed.');
            return;
        }
        logInfo('Schedule type check  : PASS — Topography Survey confirmed ("' + scheduleType + '")');
    } else {
        logInfo('Schedule type check  : No filter applied');
    }

    // 3. Resolve backup category
    let targetSubfolder = null;
    if (explicitCategory) {
        const cat = String(explicitCategory).toLowerCase();
        if (cat === 'data' || cat === 'collectedfiles')                                        targetSubfolder = 'data';
        else if (cat === 'daily_report' || cat === 'dailyreports' || cat === 'report')         targetSubfolder = 'report';
        else if (cat === 'mail' || cat === 'mailfiles')                                        targetSubfolder = 'mail';
        else {
            logSkip('Explicit category "' + explicitCategory + '" is not a backup category (only data/report/mail).');
            return;
        }
        logInfo('Category resolution  : Explicit -> "' + targetSubfolder + '"');
    }

    if (!targetSubfolder) {
        if (lowerNormPath.includes('/data/') || lowerNormPath.includes('/collectedfiles/')) {
            targetSubfolder = 'data';
        } else if (lowerNormPath.includes('/daily_report/') || lowerNormPath.includes('/dailyreports/') || lowerNormPath.includes('/report/')) {
            targetSubfolder = 'report';
        } else if (lowerNormPath.includes('/mail/') || lowerNormPath.includes('/mailfiles/')) {
            targetSubfolder = 'mail';
        }

        if (targetSubfolder) {
            logInfo('Category resolution  : Auto-detected from path -> "' + targetSubfolder + '"');
        } else {
            logSkip('File is in a non-backup category (photos/drawing/etc). Path: ' + normFilePath);
            return;
        }
    }

    try {
        const backupBase = process.env.NAS_BACKUP_PATH || '/app/storage_backup';
        logInfo('NAS backup base      : ' + backupBase);

        const clientMasterIndex = lowerNormPath.indexOf('/client_master/');
        const afterClientMaster = normFilePath.substring(clientMasterIndex + '/client_master/'.length);
        const segments = afterClientMaster.split('/');

        if (segments.length < 3) {
            logError('Cannot extract client/site — expected >= 3 segments after client_master/. Got: "' + afterClientMaster + '"');
            return;
        }

        const clientId      = segments[0];
        const siteSubfolder = segments[2];
        const fileName      = path.basename(normFilePath);

        logInfo('Client ID            : ' + clientId);
        logInfo('Site subfolder       : ' + siteSubfolder);
        logInfo('File name            : ' + fileName);
        logInfo('Backup category      : ' + targetSubfolder);

        const targetDir      = getSiteMasterPath(backupBase, clientId, siteSubfolder, targetSubfolder);
        const backupFilePath = path.join(targetDir, fileName);

        logInfo('Source path          : ' + normFilePath);
        logInfo('Backup dest path     : ' + backupFilePath);

        const doCopy = () => {
            try {
                if (!fs.existsSync(filePath)) {
                    logWarn('Source file no longer exists at: ' + filePath);
                    return;
                }

                if (!fs.existsSync(targetDir)) {
                    logInfo('Creating backup dir  : ' + targetDir);
                    fs.mkdirSync(targetDir, { recursive: true });
                    logOk('Backup dir created   : ' + targetDir);
                }

                if (fs.existsSync(backupFilePath)) {
                    logInfo('Overwriting existing backup at: ' + backupFilePath);
                }

                const srcSize = fs.statSync(filePath).size;
                fs.copyFileSync(filePath, backupFilePath);
                const dstSize = fs.statSync(backupFilePath).size;

                if (srcSize === dstSize) {
                    logOk('BACKUP SUCCESS | Category: ' + targetSubfolder + ' | Size: ' + srcSize + ' bytes');
                    logOk('Source : ' + filePath);
                    logOk('Dest   : ' + backupFilePath);
                } else {
                    logError('SIZE MISMATCH after copy! Source: ' + srcSize + ' bytes, Dest: ' + dstSize + ' bytes');
                    logError('Source : ' + filePath);
                    logError('Dest   : ' + backupFilePath);
                }
            } catch (copyErr) {
                logError('Copy failed: ' + copyErr.message);
                logError('Source : ' + filePath);
                logError('Dest   : ' + backupFilePath);
            }
        };

        if (fs.existsSync(filePath)) {
            logInfo('Source file exists — copying immediately.');
            doCopy();
        } else {
            logWarn('Source file not found yet — will retry in 400ms. Path: ' + filePath);
            setTimeout(doCopy, 400);
        }

    } catch (err) {
        logError('Unexpected error: ' + err.message);
        logError('File : ' + normFilePath);
        logError('Stack: ' + err.stack);
    }
};

module.exports = { duplicateTopographySiteFile };
