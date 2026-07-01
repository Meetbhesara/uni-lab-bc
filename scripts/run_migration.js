const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const https = require('https');

require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL || process.env.MONGO_URI;

if (!MONGO_URL) {
    console.error('❌ MONGO_URL or MONGO_URI not found in environment.');
    process.exit(1);
}

mongoose.connect(MONGO_URL).then(async () => {
    console.log('🔌 Connected to MongoDB...');
    const res = await mongoose.connection.collection('employeemasters').updateMany(
        { $or: [{ status: { $exists: false } }, { status: null }] },
        { $set: { status: 'Active' } }
    );
    console.log('Updated records count:', res.modifiedCount);
    process.exit(0);
}).catch(console.error);
