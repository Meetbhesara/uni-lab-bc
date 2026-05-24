const mongoose = require('mongoose');
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected');

        // Programmatically drop the obsolete refNo index if it exists
        try {
            const db = mongoose.connection.db;
            const collections = await db.listCollections({ name: 'instrumentmasters' }).toArray();
            if (collections.length > 0) {
                const indexes = await db.collection('instrumentmasters').indexes();
                if (indexes.some(idx => idx.name === 'refNo_1')) {
                    await db.collection('instrumentmasters').dropIndex('refNo_1');
                    console.log('Obsolete unique index refNo_1 on instrumentmasters collection successfully dropped.');
                }
            }
        } catch (idxErr) {
            console.error('Error checking/dropping refNo_1 index:', idxErr.message);
        }
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};
module.exports = connectDB;
