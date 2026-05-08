const mongoose = require('mongoose');
const SiteMaster = require('./src/models/SiteMaster');
require('dotenv').config();

async function checkDuplicates() {
    try {
        await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/mion');
        console.log('Connected to MongoDB');

        const allSites = await SiteMaster.find({});
        console.log(`Total sites: ${allSites.length}`);

        const idMap = {};
        allSites.forEach(site => {
            if (idMap[site.siteId]) {
                console.log(`Duplicate found in memory (shouldn't happen with unique index): ${site.siteId}`);
            }
            idMap[site.siteId] = site._id;
        });

        // Find the one that failed
        const failedId = '00001-0001';
        const existing = await SiteMaster.findOne({ siteId: failedId });
        if (existing) {
            console.log(`Found existing record for ${failedId}:`);
            console.log(JSON.stringify(existing, null, 2));
        } else {
            console.log(`Record for ${failedId} not found in DB? This is strange if you got a duplicate key error.`);
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkDuplicates();
