/**
 * Production Sync Script: Sync Users from MongoDB to Google Contacts
 * 
 * Features:
 * 1. Dual-layer phone matching (searchContacts + cached connections list).
 * 2. Primary Keeper Logic: Latest MongoDB user details are authoritative.
 * 3. Automatic Merge & Fix: Automatically cleans up and deletes duplicate cards in Google Contacts.
 * 4. EU- Prefix: Guarantees EU-{name} display name and EU-{username} in contact ID.
 * 5. Real-time detailed logs and final summary report.
 * 
 * Usage:
 *   node sync_users_to_google_contacts.js
 */

const path = require('path');
const fs = require('fs');

// Locate backend directory dynamically without any hardcoded OS drives
const searchLocations = [
    __dirname,
    process.cwd(),
    path.join(__dirname, '..'),
    path.join(__dirname, '../uni-bc'),
    path.join(__dirname, '../uni-lab-bc')
];

let backendDir = __dirname;
for (const loc of searchLocations) {
    if (fs.existsSync(path.join(loc, 'src', 'configs', 'db.js')) && 
        fs.existsSync(path.join(loc, 'src', 'models', 'User.js'))) {
        backendDir = loc;
        break;
    }
}

// Locate .env file dynamically
const candidateEnvPaths = [
    path.join(backendDir, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env')
];

const envFile = candidateEnvPaths.find(p => fs.existsSync(p));
if (envFile) {
    require('dotenv').config({ path: envFile });
} else {
    require('dotenv').config();
}

const connectDB = require(path.join(backendDir, 'src', 'configs', 'db'));
const User = require(path.join(backendDir, 'src', 'models', 'User'));
const { addToGoogleContacts, getLast10Digits, isValidRealEmail } = require(path.join(backendDir, 'src', 'utils', 'googleContacts'));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isValidPhoneNumber = (phone) => {
    const digits = (phone || '').toString().replace(/\D/g, '');
    if (digits.length < 10) return false;
    const last10 = digits.slice(-10);
    // Ignore dummy repeating numbers like 0000000000, 1111111111, etc.
    if (/^(\d)\1{9}$/.test(last10)) return false;
    return true;
};

async function syncUsersToGoogleContacts() {
    console.log('\n================================================================');
    console.log('🚀 HIGH-ACCURACY GOOGLE CONTACTS USER SYNC & DEDUPLICATION');
    console.log('================================================================');
    console.log(`Backend Root: ${backendDir}`);
    console.log(`Env File:     ${envFile || 'Using process.env'}`);
    console.log('----------------------------------------------------------------\n');

    // 1. Connect to Database
    await connectDB();

    // 2. Fetch all users from User collection
    const users = await User.find({}).lean();
    console.log(`📋 Found ${users.length} total user records in MongoDB.\n`);

    const summary = {
        total: users.length,
        skippedInvalidPhone: 0,
        skippedDuplicateInBatch: 0,
        updatedInGoogle: 0,
        addedToGoogle: 0,
        duplicatesCleaned: 0,
        errors: 0
    };

    const processedPhones = new Set();

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const rawPhone = (u.phone || '').trim();
        const last10 = getLast10Digits(rawPhone);

        const displayName = (u.contactPersonName && u.contactPersonName.trim()) 
            || (u.name && u.name.trim()) 
            || (u.companyName && u.companyName.trim()) 
            || 'Client';

        const email = u.email && isValidRealEmail(u.email) ? u.email.trim() : '';
        const company = u.companyName && !['None', 'Guest', 'undefined'].includes(u.companyName.trim()) 
            ? u.companyName.trim() 
            : '';
        const address = (u.address || '').toString().trim();
        const gstNumber = (u.gstNumber || '').toString().trim();
        const username = (u.name || u.contactPersonName || u.companyName || last10).trim();

        // 1. Check phone validity
        if (!isValidPhoneNumber(rawPhone)) {
            console.log(`[${i + 1}/${users.length}] ⚠️ Skipped "${displayName}": Invalid phone "${rawPhone}"`);
            summary.skippedInvalidPhone++;
            continue;
        }

        // 2. Avoid processing the same phone twice in the same batch
        if (processedPhones.has(last10)) {
            console.log(`[${i + 1}/${users.length}] ⏭️ Skipped "${displayName}": Duplicate phone ${rawPhone} already synced in this run`);
            summary.skippedDuplicateInBatch++;
            continue;
        }
        processedPhones.add(last10);

        process.stdout.write(`[${i + 1}/${users.length}] Syncing: "${displayName}" (${rawPhone})... `);

        try {
            // Authoritative Primary Keeper Sync:
            // Updates primary contact with EU- prefix & payload details, and auto-deletes any duplicate cards!
            const result = await addToGoogleContacts({
                name: displayName,
                phone: rawPhone,
                email: email || undefined,
                company: company,
                address: address,
                gstNumber: gstNumber,
                username: username,
                source: 'User Database Sync'
            });

            if (result && result.success) {
                if (result.added) {
                    console.log(`✅ CREATED NEW ("${result.contactName}")`);
                    summary.addedToGoogle++;
                } else if (result.updated) {
                    const diffCount = (result.fieldChanges?.updatedFields?.length || 0) + (result.fieldChanges?.addedFields?.length || 0);
                    const delCount = result.deletedDuplicates?.length || 0;
                    if (delCount > 0) summary.duplicatesCleaned += delCount;
                    console.log(`🔄 UPDATED ("${result.contactName}" | ${diffCount} fields changed${delCount > 0 ? ` | 🗑️ ${delCount} duplicate card(s) deleted` : ''})`);
                    summary.updatedInGoogle++;
                } else {
                    console.log(`✅ In Sync`);
                }
            } else {
                console.log(`⚠️ Skipped (${result?.reason || result?.error || 'Unknown'})`);
                summary.errors++;
            }
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
            summary.errors++;
        }

        // Gentle delay between requests to respect Google People API rate limits
        await delay(350);
    }

    console.log('\n================================================================');
    console.log('📊 GOOGLE CONTACTS USER SYNC COMPLETE');
    console.log('================================================================');
    console.log(`Total DB User Records:              ${summary.total}`);
    console.log(`Skipped (Invalid/Dummy Phone):      ${summary.skippedInvalidPhone}`);
    console.log(`Skipped (Duplicate Phone in DB):    ${summary.skippedDuplicateInBatch}`);
    console.log(`✅ Primary Contacts UPDATED:         ${summary.updatedInGoogle}`);
    console.log(`🆕 New Contacts CREATED:            ${summary.addedToGoogle}`);
    console.log(`🗑️ Redundant Duplicates DELETED:    ${summary.duplicatesCleaned}`);
    if (summary.errors > 0) {
        console.log(`⚠️ Errors Encountered:              ${summary.errors}`);
    }
    console.log('================================================================\n');

    process.exit(0);
}

if (require.main === module) {
    syncUsersToGoogleContacts().catch((err) => {
        console.error('Fatal sync script error:', err);
        process.exit(1);
    });
}

module.exports = { syncUsersToGoogleContacts };
