const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const setSuperAdmins = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB connected successfully.');

        const targetEmails = ['iatulkanak@gamil.com', 'meetmanojbhai4@gmail.com'];
        console.log('Target emails for Super Admin upgrade:', targetEmails);

        const result = await User.updateMany(
            { email: { $in: targetEmails } },
            { $set: { isSuperAdmin: true, isAdmin: true } }
        );

        console.log(`Update result: Modified ${result.modifiedCount} document(s).`);

        // Display updated users to confirm success
        const updatedUsers = await User.find({ email: { $in: targetEmails } });
        console.log('Current status of target users:');
        updatedUsers.forEach(user => {
            console.log(`- Email: ${user.email} | isAdmin: ${user.isAdmin} | isSuperAdmin: ${user.isSuperAdmin}`);
        });

        process.exit(0);
    } catch (err) {
        console.error('Failed to update Super Admins:', err);
        process.exit(1);
    }
};

setSuperAdmins();
