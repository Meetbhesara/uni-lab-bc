const mongoose = require('mongoose');
const SiteMaster = require('./src/models/SiteMaster');
const ClientMaster = require('./src/models/ClientMaster');
require('dotenv').config();

async function checkInconsistency() {
    try {
        await mongoose.connect(process.env.MONGO_URL);
        console.log('Connected to MongoDB');

        const allSites = await SiteMaster.find({});
        console.log(`Checking ${allSites.length} sites...`);

        const orphans = [];
        for (const site of allSites) {
            if (!site.client) {
                orphans.push({ id: site._id, siteId: site.siteId, reason: 'No client field' });
                continue;
            }
            const client = await ClientMaster.findById(site.client);
            if (!client) {
                orphans.push({ id: site._id, siteId: site.siteId, reason: `Client ${site.client} not found` });
                continue;
            }
            
            // Check if siteId prefix matches client clientId
            const expectedPrefix = client.clientId;
            if (site.siteId && !site.siteId.startsWith(expectedPrefix)) {
                orphans.push({ 
                    id: site._id, 
                    siteId: site.siteId, 
                    reason: `Prefix mismatch. Expected ${expectedPrefix}, got ${site.siteId}` 
                });
            }
        }

        if (orphans.length > 0) {
            console.log('\nInconsistencies found:');
            console.table(orphans);
            // Optionally delete them? Better just report for now.
            console.log('\nYou can delete these orphaned sites to fix the sequence issues.');
        } else {
            console.log('No inconsistencies found.');
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkInconsistency();
