const fs = require('fs');
const path = require('path');

/**
 * Resolves an existing folder inside parentDir using case-insensitive matching.
 * Falls back to returning the desired path if no match is found.
 */
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

/**
 * Resolves an existing SITE folder inside a site_master directory.
 *
 * Strategy (in priority order):
 *  1. Exact match (fastest, handles clean cases)
 *  2. Case-insensitive full-name match (handles NAS case sensitivity)
 *  3. Match by siteId prefix only (e.g. "0001-") — catches folders where
 *     the site name was changed after creation or had a different case
 *
 * If no existing folder is found, returns path built from siteSubfolder
 * so the caller can create a new folder exactly as intended.
 *
 * @param {string} siteMasterDir  - full path to the site_master directory
 * @param {string} siteId         - the short site ID e.g. "0001-0003"
 * @param {string} siteSubfolder  - desired full folder name e.g. "0001-0003-Sunrise Survey"
 */
function resolveExistingSiteFolder(siteMasterDir, siteId, siteSubfolder) {
    if (!siteMasterDir || !siteSubfolder) return path.join(siteMasterDir || '', siteSubfolder || '');
    try {
        if (fs.existsSync(siteMasterDir)) {
            const entries = fs.readdirSync(siteMasterDir);

            // 1. Exact match
            if (entries.includes(siteSubfolder)) {
                return path.join(siteMasterDir, siteSubfolder);
            }

            // 2. Case-insensitive full-name match
            const lowerDesired = siteSubfolder.toLowerCase().trim();
            const caseMatch = entries.find(e => e.toLowerCase().trim() === lowerDesired);
            if (caseMatch) {
                return path.join(siteMasterDir, caseMatch);
            }

            // 3. Match by siteId prefix — most robust against case/name drift
            if (siteId) {
                const lowerPrefix = (siteId + '-').toLowerCase();
                const prefixMatch = entries.find(e => e.toLowerCase().startsWith(lowerPrefix));
                if (prefixMatch) {
                    return path.join(siteMasterDir, prefixMatch);
                }
            }
        }
    } catch (e) {}
    // Not found — return the desired path so caller creates a fresh folder
    return path.join(siteMasterDir, siteSubfolder);
}

/**
 * Builds the full NAS/local path for a site file category.
 *
 * @param {string} basePath       - NAS or local root
 * @param {string} clientShortId  - client short ID (e.g. "0001")
 * @param {string} siteSubfolder  - full site folder name (e.g. "0001-0003-Site Name")
 * @param {string} subCategory    - file category: photos | Daily_report | data | drawing | Mail
 * @param {string} [siteId]       - site short ID used for prefix-based folder lookup
 */
function getSiteMasterPath(basePath, clientShortId, siteSubfolder, subCategory = '', siteId = '') {
    const cleanClient = String(clientShortId || 'unknown_client').trim();
    const cleanSite = String(siteSubfolder || 'unknown_site').trim();
    const cleanSiteId = String(siteId || '').trim();

    const clientMasterRoot = path.join(basePath, 'client_master');

    // Resolve client folder (case-insensitive)
    const clientDir = resolveExistingFolder(clientMasterRoot, cleanClient);

    // Resolve site folder using the smarter site resolver
    const siteMasterRoot = path.join(clientDir, 'site_master');
    const siteDir = resolveExistingSiteFolder(siteMasterRoot, cleanSiteId, cleanSite);

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
    resolveExistingSiteFolder,
    getSiteMasterPath,
    resolveCaseInsensitiveFile
};
