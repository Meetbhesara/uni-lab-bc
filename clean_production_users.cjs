/**
 * Production Migration Script: Clean & Standardize Phone Numbers for 233 Users
 * 
 * What this script does:
 * 1. Connects to MongoDB using your MONGO_URI.
 * 2. Scans all records in the User collection.
 * 3. Normalizes all phone numbers by removing spaces, dashes, '+91', '91', and leading '0',
 *    ensuring every phone number is strictly the core 10 digits (e.g. "87580 35558" -> "8758035558").
 * 4. Safely handles and merges duplicate records if a user was created twice (keeps the most complete profile).
 * 5. Prints a clear before/after report of every updated user.
 * 
 * Usage:
 *   node clean_production_users.cjs
 *   OR with custom connection string:
 *   node clean_production_users.cjs "mongodb+srv://<user>:<password>@cluster.mongodb.net/your-db"
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Determine MongoDB Connection URI
const mongoUri = process.argv[2] || process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

if (!mongoUri) {
    console.error("\x1b[31m%s\x1b[0m", "❌ Error: MongoDB connection string not found!");
    console.log("Please pass it as an argument or set MONGO_URI in your .env file:");
    console.log('Example: node clean_production_users.cjs "mongodb+srv://user:pass@cluster.mongodb.net/dbname"\n');
    process.exit(1);
}

// User Schema Definition (flexible to accommodate existing schema)
const userSchema = new mongoose.Schema({
    name: String,
    contactPersonName: String,
    companyName: String,
    email: String,
    phone: String,
    gstNumber: String,
    address: String,
    isAdmin: Boolean,
    isSuperAdmin: Boolean,
    permissions: Object
}, { timestamps: true, strict: false });

const User = mongoose.model('User', userSchema);

async function runMigration() {
    try {
        console.log("\x1b[36m%s\x1b[0m", "\n=======================================================");
        console.log("\x1b[36m%s\x1b[0m", " 🚀 Starting Production Phone Number Cleanup & Migration");
        console.log("\x1b[36m%s\x1b[0m", "=======================================================\n");

        console.log("Connecting to MongoDB...");
        await mongoose.connect(mongoUri);
        console.log("\x1b[32m%s\x1b[0m", "✓ Successfully connected to MongoDB database.\n");

        const users = await User.find({}).sort({ createdAt: 1 });
        console.log(`Found ${users.length} total users in database.\n`);

        let updatedCount = 0;
        let unchangedCount = 0;
        let duplicateMergedCount = 0;
        let invalidPhoneCount = 0;

        // Map to track 10-digit phone numbers and detect duplicates
        const phoneMap = new Map(); // clean10 -> User Document

        for (const user of users) {
            const originalPhone = (user.phone || '').trim();

            if (!originalPhone) {
                invalidPhoneCount++;
                continue;
            }

            // Extract last 10 digits
            const rawDigits = originalPhone.replace(/\D/g, '');
            const clean10 = rawDigits.slice(-10);

            if (clean10.length !== 10) {
                console.log(`\x1b[33m[SKIPPED - INVALID LENGTH]\x1b[0m ID: ${user._id} | Phone: "${originalPhone}" (Only ${rawDigits.length} digits)`);
                invalidPhoneCount++;
                continue;
            }

            // Check if another user already has this clean 10-digit number (Duplicate detected!)
            if (phoneMap.has(clean10)) {
                const existingUser = phoneMap.get(clean10);
                console.log(`\x1b[35m[DUPLICATE DETECTED]\x1b[0m Merging duplicate for phone: ${clean10}`);
                console.log(`  - Existing Record: "${existingUser.name || existingUser.contactPersonName || existingUser.companyName}" (${existingUser.email})`);
                console.log(`  - Duplicate Record: "${user.name || user.contactPersonName || user.companyName}" (${user.email})`);

                // Merge richer details into existing user
                let needsSave = false;
                if (!existingUser.companyName && user.companyName) { existingUser.companyName = user.companyName; needsSave = true; }
                if (!existingUser.contactPersonName && user.contactPersonName) { existingUser.contactPersonName = user.contactPersonName; needsSave = true; }
                if (!existingUser.name && user.name) { existingUser.name = user.name; needsSave = true; }
                if ((!existingUser.email || existingUser.email.includes('gmail.com')) && user.email && !user.email.includes('gmail.com')) {
                    existingUser.email = user.email;
                    needsSave = true;
                }
                if (!existingUser.gstNumber && user.gstNumber) { existingUser.gstNumber = user.gstNumber; needsSave = true; }
                if (!existingUser.address && user.address) { existingUser.address = user.address; needsSave = true; }

                if (needsSave) {
                    await existingUser.save();
                }

                // Delete the duplicate record so unique phone indexing will never fail
                await User.deleteOne({ _id: user._id });
                duplicateMergedCount++;
                console.log(`  \x1b[32m✓ Merged and removed duplicate record ID: ${user._id}\x1b[0m\n`);
                continue;
            }

            // If phone needs formatting
            if (originalPhone !== clean10) {
                const displayName = user.contactPersonName || user.name || user.companyName || 'User';
                console.log(`\x1b[32m[UPDATED]\x1b[0m "${originalPhone}"  ➔  "${clean10}"  (${displayName} | ${user.email})`);
                user.phone = clean10;
                await user.save();
                updatedCount++;
            } else {
                unchangedCount++;
            }

            phoneMap.set(clean10, user);
        }

        console.log("\n\x1b[36m%s\x1b[0m", "=======================================================");
        console.log("\x1b[32m%s\x1b[0m", " 🎉 MIGRATION COMPLETE SUMMARY:");
        console.log(` • Phone numbers cleaned & formatted:  \x1b[32m${updatedCount}\x1b[0m`);
        console.log(` • Duplicate users merged & removed:   \x1b[35m${duplicateMergedCount}\x1b[0m`);
        console.log(` • Already in clean 10-digit format:   ${unchangedCount}`);
        console.log(` • Records with missing/short phones:  ${invalidPhoneCount}`);
        console.log(` • Total unique clients now active:    \x1b[32m${phoneMap.size}\x1b[0m`);
        console.log("\x1b[36m%s\x1b[0m", "=======================================================\n");

    } catch (err) {
        console.error("\x1b[31m%s\x1b[0m", "❌ Migration Failed with Error:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Database connection closed.");
        process.exit(0);
    }
}

runMigration();
