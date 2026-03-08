const m = require('mongoose');

m.connect('mongodb+srv://meetbhesara26_db_user:YQjsVvG2nicSwyoG@cluster0.l85tmvc.mongodb.net/mion?appName=Cluster0')
    .then(async () => {
        const p = await m.connection.db.collection('products').find({ category: { $exists: true } }).toArray();
        console.log(JSON.stringify(p.map(x => ({ n: x.name, c: x.category })), null, 2));
        m.disconnect();
    })
    .catch(e => console.error(e));
