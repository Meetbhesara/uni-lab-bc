/**
 * One-time Migration Script: Sync Existing Client Master Records to Google Contacts
 * 
 * Multi-Platform & NAS Ready:
 * - Synology NAS (e.g. /volume1/docker/...)
 * - Docker Containers (/app)
 * - Linux / Production VPS
 * - Local Development (Windows / macOS / Linux)
 * 
 * Features:
 * 1. Fully platform-agnostic (ZERO hardcoded OS drives or paths).
 * 2. Auto-detects backend directory and .env location.
 * 3. Supports multiple phone numbers per client (saves all valid numbers to the same contact).
 * 4. Saves full client address (street, pincode, state).
 * 5. Checks against Google Contacts via People API before adding:
 *    - If ANY phone number already exists in Google Contacts -> SKIPS (prevents duplicate).
 *    - If NOT in Google Contacts -> ADDS new contact with all numbers & address.
 * 6. Deduplicates across the batch (never re-processes the same phone number).
 * 7. Skips invalid/dummy numbers.
 * 8. Real-time terminal logs and a final summary report.
 * 
 * Usage:
 *   node sync_clients_to_google_contacts.js
 */

const path = require('path');
const fs = require('fs');

// Locate backend directory dynamically without hardcoded OS drives
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
        fs.existsSync(path.join(loc, 'src', 'models', 'ClientMaster.js'))) {
        backendDir = loc;
        break;
    }
}

// Locate .env dynamically
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

// Portable imports
const connectDB = require(path.join(backendDir, 'src', 'configs', 'db'));
const ClientMaster = require(path.join(backendDir, 'src', 'models', 'ClientMaster'));
const { addToGoogleContacts, getLast10Digits } = require(path.join(backendDir, 'src', 'utils', 'googleContacts'));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isValidPhoneNumber = (phone) => {
    const digits = (phone || '').toString().replace(/\D/g, '');
    if (digits.length < 10) return false;
    const last10 = digits.slice(-10);
    // Ignore dummy repeating numbers (e.g. 0000000000, 1111111111)
    if (/^(\d)\1{9}$/.test(last10)) return false;
    return true;
};

async function syncClientsToGoogleContacts() {
    console.log('\n================================================================');
    console.log('🚀 GOOGLE CONTACTS CLIENT MASTER SYNC SCRIPT');
    console.log('================================================================');
    console.log('System Info:');
    console.log(`  OS Platform:     ${process.platform}`);
    console.log(`  Backend Root:    ${backendDir}`);
    console.log(`  Env Config:      ${envFile || 'Environment variables (Docker/System)'}`);
    console.log('----------------------------------------------------------------\n');

    // 1. Connect to MongoDB
    await connectDB();

    // 2. Fetch all clients from ClientMaster collection
    const clients = await ClientMaster.find({}).sort({ createdAt: 1 }).lean();
    console.log(`📋 Found ${clients.length} total client records in MongoDB.\n`);

    const summary = {
        total: clients.length,
        skippedNoPhone: 0,
        skippedDuplicateInBatch: 0,
        skippedAlreadyInGoogle: 0,
        addedToGoogle: 0,
        errors: 0
    };

    const processedPhones = new Set();

    for (let i = 0; i < clients.length; i++) {
        const c = clients[i];

        const displayName = (c.contactPerson && c.contactPerson.name && c.contactPerson.name.trim()) 
            || (c.clientName && c.clientName.trim()) 
            || 'Client';

        const company = (c.clientName && c.clientName.trim()) || '';

        // Collect all potential phone numbers for this client
        const rawPhones = [
            c.contactPerson && c.contactPerson.phone,
            ...(Array.isArray(c.contactNumbers) ? c.contactNumbers : [])
        ].map(p => (p || '').toString().trim()).filter(Boolean);

        // Filter valid phones & deduplicate within this client
        const clientPhones = [];
        const thisClientDigits = new Set();
        for (const p of rawPhones) {
            if (isValidPhoneNumber(p)) {
                const last10 = getLast10Digits(p);
                if (!thisClientDigits.has(last10)) {
                    thisClientDigits.add(last10);
                    clientPhones.push(p);
                }
            }
        }

        const phoneDisplay = clientPhones.length > 0 ? clientPhones.join(', ') : 'NONE';
        console.log(`\n[${i + 1}/${clients.length}] Processing Client: "${displayName}" (Company: "${company}", Phones: [${phoneDisplay}])`);

        if (clientPhones.length === 0) {
            console.log(`   ⚠️ Skipped: No valid phone numbers found for "${displayName}".`);
            summary.skippedNoPhone++;
            continue;
        }

        // Check if all of this client's numbers were already processed in earlier records in this batch
        const allAlreadyProcessed = clientPhones.every(p => processedPhones.has(getLast10Digits(p)));
        if (allAlreadyProcessed) {
            console.log(`   ⏭️ Skipped: Phone numbers for "${displayName}" were already processed earlier in this migration batch.`);
            summary.skippedDuplicateInBatch++;
            continue;
        }

        // Mark phones as processed in this batch
        for (const p of clientPhones) {
            processedPhones.add(getLast10Digits(p));
        }

        // Prepare emails
        const emails = (Array.isArray(c.emails) && c.emails.length > 0) 
            ? c.emails 
            : (c.email ? [c.email] : []);

        // Prepare address
        const address = {
            street: c.clientAddress || '',
            pincode: c.pincode || '',
            state: c.state || ''
        };

        try {
            // Call addToGoogleContacts (which checks each phone in Google Contacts first!)
            const result = await addToGoogleContacts({
                name: displayName,
                phones: clientPhones,
                emails: emails,
                company: company,
                address: address,
                gstNumber: c.gstNo || '',
                source: 'Client Master Migration'
            });

            if (result && result.added) {
                summary.addedToGoogle++;
            } else if (result && result.reason === 'Already exists in Google Contacts') {
                summary.skippedAlreadyInGoogle++;
            } else {
                summary.errors++;
            }
        } catch (err) {
            console.error(`   ❌ Error processing client "${displayName}":`, err.message);
            summary.errors++;
        }

        // Brief delay between requests to be gentle with Google API rate limits
        await delay(500);
    }

    console.log('\n================================================================');
    console.log('📊 CLIENT MASTER SYNC SUMMARY REPORT');
    console.log('================================================================');
    console.log(`Total Client records in DB:             ${summary.total}`);
    console.log(`Skipped (No Valid Phone):               ${summary.skippedNoPhone}`);
    console.log(`Skipped (Duplicate phone within batch): ${summary.skippedDuplicateInBatch}`);
    console.log(`Skipped (ALREADY in Google Contacts):   ${summary.skippedAlreadyInGoogle}`);
    console.log(`✅ NEWLY ADDED to Google Contacts:      ${summary.addedToGoogle}`);
    if (summary.errors > 0) {
        console.log(`❌ Errors encountered:                  ${summary.errors}`);
    }
    console.log('================================================================\n');

    process.exit(0);
}

syncClientsToGoogleContacts().catch((err) => {
    console.error('Fatal sync script error:', err);
    process.exit(1);
});
