/**
 * One-time Sync Script: Sync Users from MongoDB to Google Contacts
 * 
 * Multi-Platform & NAS Ready:
 * - Synology NAS (e.g. /volume1/docker/...)
 * - Docker Containers (/app)
 * - Linux / Production VPS
 * - Local Development (Windows / macOS / Linux)
 * 
 * Features:
 * 1. Fully platform-agnostic (ZERO hardcoded OS drives or directory paths).
 * 2. Auto-detects backend directory and .env location relative to __dirname / process.cwd().
 * 3. Checks each user's phone against Google Contacts (People API).
 * 4. If phone already exists in Google Contacts -> SKIPS (prevents duplicate).
 * 5. If phone does NOT exist in Google Contacts -> ADDS new contact.
 * 6. Deduplicates within the database batch (never processes the same phone twice).
 * 7. Skips invalid/dummy numbers (e.g. all zeros).
 * 8. Real-time terminal logs and a final summary report.
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

// Portable imports using relative path resolution
const connectDB = require(path.join(backendDir, 'src', 'configs', 'db'));
const User = require(path.join(backendDir, 'src', 'models', 'User'));
const { addToGoogleContacts, getLast10Digits } = require(path.join(backendDir, 'src', 'utils', 'googleContacts'));

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
    console.log('🚀 GOOGLE CONTACTS USER SYNC SCRIPT');
    console.log('================================================================');
    console.log('System Info:');
    console.log(`  OS Platform:     ${process.platform}`);
    console.log(`  Backend Root:    ${backendDir}`);
    console.log(`  Env Config:      ${envFile || 'Environment variables (Docker/System)'}`);
    console.log('----------------------------------------------------------------\n');

    // 1. Connect to Database
    await connectDB();

    // 2. Fetch all users from User collection
    const users = await User.find({}).lean();
    console.log(`📋 Found ${users.length} total user records in MongoDB.\n`);

    const summary = {
        total: users.length,
        skippedInvalidPhone: 0,
        skippedDuplicateInDb: 0,
        skippedAlreadyInGoogle: 0,
        addedToGoogle: 0,
        errors: 0
    };

    const processedPhones = new Set();

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const rawPhone = (u.phone || '').trim();
        const last10 = getLast10Digits(rawPhone);

        const displayName = (u.name && u.name.trim()) 
            || (u.contactPersonName && u.contactPersonName.trim()) 
            || (u.companyName && u.companyName.trim()) 
            || 'Client';

        const email = u.email && !u.email.endsWith('@gmail.com') && !u.email.includes('noemail') 
            ? u.email.trim() 
            : (u.email || '');

        const company = u.companyName && u.companyName !== 'None' && u.companyName !== 'Guest' 
            ? u.companyName.trim() 
            : '';

        console.log(`\n[${i + 1}/${users.length}] Checking: "${displayName}" (Phone: ${rawPhone || 'EMPTY'})`);

        // Check if phone number is valid
        if (!isValidPhoneNumber(rawPhone)) {
            console.log(`   ⚠️ Skipped: Invalid or dummy phone number "${rawPhone}".`);
            summary.skippedInvalidPhone++;
            continue;
        }

        // Check if we already processed this phone earlier in this script run
        if (processedPhones.has(last10)) {
            console.log(`   ⏭️ Skipped: Phone "${rawPhone}" was already processed from an earlier user record in this batch.`);
            summary.skippedDuplicateInDb++;
            continue;
        }

        processedPhones.add(last10);

        try {
            // Call addToGoogleContacts (which checks Google Contacts first!)
            const result = await addToGoogleContacts({
                name: displayName,
                phone: rawPhone,
                email: email,
                company: company,
                source: 'User Model Migration'
            });

            if (result && result.added) {
                summary.addedToGoogle++;
            } else if (result && result.reason === 'Already exists in Google Contacts') {
                summary.skippedAlreadyInGoogle++;
            } else {
                summary.errors++;
            }
        } catch (err) {
            console.error(`   ❌ Error processing user "${displayName}":`, err.message);
            summary.errors++;
        }

        // Brief delay between requests to be gentle with Google API rate limits
        await delay(500);
    }

    console.log('\n================================================================');
    console.log('📊 SYNC SUMMARY REPORT');
    console.log('================================================================');
    console.log(`Total User records in DB:               ${summary.total}`);
    console.log(`Skipped (Invalid/Dummy Phone):          ${summary.skippedInvalidPhone}`);
    console.log(`Skipped (Duplicate phone within DB):    ${summary.skippedDuplicateInDb}`);
    console.log(`Skipped (ALREADY in Google Contacts):   ${summary.skippedAlreadyInGoogle}`);
    console.log(`✅ NEWLY ADDED to Google Contacts:      ${summary.addedToGoogle}`);
    if (summary.errors > 0) {
        console.log(`❌ Errors encountered:                  ${summary.errors}`);
    }
    console.log('================================================================\n');

    process.exit(0);
}

syncUsersToGoogleContacts().catch((err) => {
    console.error('Fatal sync script error:', err);
    process.exit(1);
});
