const fs = require('fs');
const path = require('path');

function resolveExistingFolder(parentDir, desiredName) {
    if (!parentDir || !desiredName) return path.join(parentDir || '', desiredName || '');
    try {
        if (fs.existsSync(parentDir)) {
            const entries = fs.readdirSync(parentDir);
            const lowerDesired = desiredName.toLowerCase().trim();
            const match = entries.find(e => e.toLowerCase().trim() === lowerDesired);
            if (match) {
                return path.join(parentDir, match);
            }
        }
    } catch (e) {}
    return path.join(parentDir, desiredName);
}

function getSiteMasterPath(basePath, clientShortId, siteSubfolder, subCategory = '') {
    const cleanClient = String(clientShortId || 'unknown_client').trim();
    const cleanSite = String(siteSubfolder || 'unknown_site').trim();

    const clientMasterRoot = path.join(basePath, 'client_master');
    const clientDir = resolveExistingFolder(clientMasterRoot, cleanClient);

    const siteMasterRoot = path.join(clientDir, 'site_master');
    const siteDir = resolveExistingFolder(siteMasterRoot, cleanSite);

    if (subCategory) {
        let targetSub = subCategory;
        if (subCategory.toLowerCase() === 'mail' || subCategory.toLowerCase() === 'mailfiles') targetSub = 'Mail';
        else if (subCategory.toLowerCase() === 'data' || subCategory.toLowerCase() === 'collectedfiles') targetSub = 'data';
        else if (subCategory.toLowerCase() === 'daily_report' || subCategory.toLowerCase() === 'dailyreports' || subCategory.toLowerCase() === 'report') targetSub = 'Daily_report';
        else if (subCategory.toLowerCase() === 'photos' || subCategory.toLowerCase() === 'photo') targetSub = 'photos';
        else if (subCategory.toLowerCase() === 'drawing' || subCategory.toLowerCase() === 'drafting') targetSub = 'drawing';

        return resolveExistingFolder(siteDir, targetSub);
    }

    return siteDir;
}

function resolveCaseInsensitiveFile(basePath, relativeUrl) {
    if (!basePath || !relativeUrl) return null;
    try {
        let cleanRel = relativeUrl.replace(/\\/g, '/');
        if (cleanRel.startsWith('/uploads/')) cleanRel = cleanRel.substring('/uploads/'.length);
        else if (cleanRel.startsWith('/api/uploads/')) cleanRel = cleanRel.substring('/api/uploads/'.length);
        else if (cleanRel.startsWith('/')) cleanRel = cleanRel.substring(1);

        const segments = cleanRel.split('/').filter(Boolean);
        let current = basePath;

        for (const segment of segments) {
            if (!fs.existsSync(current)) return null;
            const items = fs.readdirSync(current);
            const lowerSegment = segment.toLowerCase();

            const match = items.find(item => item.toLowerCase() === lowerSegment);
            if (!match) return null;
            current = path.join(current, match);
        }

        if (fs.existsSync(current) && fs.lstatSync(current).isFile()) {
            return current;
        }
    } catch (err) {}
    return null;
}

module.exports = {
    resolveExistingFolder,
    getSiteMasterPath,
    resolveCaseInsensitiveFile
};
