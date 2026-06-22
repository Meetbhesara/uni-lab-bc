const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const setSuperAdmins = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB connected successfully.');

        const targetEmails = ['iatulkanak@gamil.com', 'meetmanojbhai4@gmail.com'];
        console.log('Target emails (case-insensitive search):', targetEmails);

        const dbCollection = mongoose.connection.db.collection('users');

        for (const email of targetEmails) {
            const regex = new RegExp(`^${email.trim()}$`, 'i');
            const foundUser = await dbCollection.findOne({ email: { $regex: regex } });
            
            if (foundUser) {
                console.log(`Found user: ${foundUser.email} (ID: ${foundUser._id})`);
                const updateRes = await dbCollection.updateOne(
                    { _id: foundUser._id },
                    { $set: { isSuperAdmin: true, isAdmin: true } }
                );
                console.log(`- Promotion result: matchedCount=${updateRes.matchedCount}, modifiedCount=${updateRes.modifiedCount}`);
            } else {
                console.log(`User with email "${email}" NOT found in the database.`);
            }
        }

        console.log('\nFinal verification:');
        for (const email of targetEmails) {
            const regex = new RegExp(`^${email.trim()}$`, 'i');
            const updated = await dbCollection.findOne({ email: { $regex: regex } });
            if (updated) {
                console.log(`- ${updated.email}: isAdmin=${updated.isAdmin}, isSuperAdmin=${updated.isSuperAdmin}`);
            } else {
                console.log(`- ${email}: NOT FOUND`);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Failed to update Super Admins:', err);
        process.exit(1);
    }
};

setSuperAdmins();
