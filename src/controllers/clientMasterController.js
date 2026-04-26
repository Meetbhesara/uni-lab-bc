const ClientMaster = require('../models/ClientMaster');
const Counter = require('../models/Counter');
const path = require('path');
const fs = require('fs');

const storeClientMaster = async (req, res) => {
    try {
        console.log('Incoming Client Master data:', req.body);
        console.log('Incoming Client Master files:', req.files);

        const { 
            clientName, 
            refNo, 
            email, 
            contactPersonName, 
            contactPersonPhone, 
            panCard,
            clientAddress,
            gstNo, 
            msmeNo 
        } = req.body;
        const files = req.files;

        // Auto-generate Client ID
        const counter = await Counter.findByIdAndUpdate(
            'clientId',
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );
        const generatedClientId = `CLNT${String(counter.seq).padStart(6, '0')}`;

        // Folder naming: clientName-clientId
        const namePart = (clientName || 'unknown_client').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const idPart = generatedClientId.toLowerCase();
        const folderName = `${namePart}-${idPart}`;

        // If folder created by multer (using req.body.clientId) is different, rename it
        const reqClientId = (req.body.clientId || '').toLowerCase();
        if (reqClientId && reqClientId !== idPart) {
            const useNas = process.env.USE_NAS === 'true';
            const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';
            
            const tempFolderName = `${namePart}-${reqClientId}`;
            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            const oldDir = path.join(absoluteLocalBase, 'client_master', tempFolderName);
            const newDir = path.join(absoluteLocalBase, 'client_master', folderName);
            if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);

            if (useNas) {
                const oldNas = path.join(nasBase, 'myapp', 'client_master', tempFolderName);
                const newNas = path.join(nasBase, 'myapp', 'client_master', folderName);
                if (fs.existsSync(oldNas)) fs.renameSync(oldNas, newNas);
            }
        }

        const documents = [];
        if (files) {
            const processFile = (file, type) => {
                const f = Array.isArray(file) ? file[0] : file;
                return { 
                    name: f.originalname, 
                    type, 
                    url: `/uploads/client_master/${folderName}/${path.basename(f.path)}`, 
                    path: f.path.replace(`-${reqClientId}`, `-${idPart}`)
                };
            };
            if (files.gstCert) documents.push(processFile(files.gstCert, 'GST'));
            if (files.msmeCert) documents.push(processFile(files.msmeCert, 'MSME'));
        }

        const record = new ClientMaster({ 
            clientId: generatedClientId,
            clientName: clientName ? clientName.trim() : undefined, 
            refNo, 
            email: email ? email.toLowerCase().trim() : undefined, 
            contactPerson: {
                name: contactPersonName,
                phone: contactPersonPhone
            }, 
            panCard,
            clientAddress,
            gstNo, 
            msmeNo,
            documents 
        });

        await record.save();
        res.status(201).json({ success: true, message: 'Client record stored successfully', data: record });
    } catch (error) {
        console.error('Error in storeClientMaster:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

const updateClientMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const oldRecord = await ClientMaster.findById(_id);
        if (!oldRecord) return res.status(404).json({ success: false, message: 'Client not found' });

        const { 
            clientName, refNo, email, contactPersonName, contactPersonPhone, panCard, clientAddress, gstNo, msmeNo 
        } = req.body;
        const files = req.files;

        const oldNamePart = oldRecord.clientName.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const oldIdPart = (oldRecord.clientId || '').toLowerCase();
        const oldFolderName = oldIdPart ? `${oldNamePart}-${oldIdPart}` : oldNamePart;

        const newNamePart = (clientName || oldRecord.clientName).trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const newIdPart = oldIdPart;
        const newFolderName = newIdPart ? `${newNamePart}-${newIdPart}` : newNamePart;

        if (oldFolderName !== newFolderName) {
            const useNas = process.env.USE_NAS === 'true';
            const nasBase = process.env.NAS_BASE_PATH || '/volume1/work';
            const localBase = process.env.LOCAL_BASE_PATH || './uploads';

            const absoluteLocalBase = path.isAbsolute(localBase) ? localBase : path.join(process.cwd(), localBase);
            const oldLocalDir = path.join(absoluteLocalBase, 'client_master', oldFolderName);
            const newLocalDir = path.join(absoluteLocalBase, 'client_master', newFolderName);

            if (fs.existsSync(oldLocalDir)) {
                if (fs.existsSync(newLocalDir)) {
                    fs.readdirSync(oldLocalDir).forEach(file => {
                        const src = path.join(oldLocalDir, file);
                        const dest = path.join(newLocalDir, file);
                        if (!fs.existsSync(dest)) fs.renameSync(src, dest);
                    });
                    fs.rmSync(oldLocalDir, { recursive: true, force: true });
                } else {
                    fs.renameSync(oldLocalDir, newLocalDir);
                }
            }

            if (useNas) {
                const oldNasDir = path.join(nasBase, 'myapp', 'client_master', oldFolderName);
                const newNasDir = path.join(nasBase, 'myapp', 'client_master', newFolderName);
                if (fs.existsSync(oldNasDir)) {
                    if (fs.existsSync(newNasDir)) {
                        fs.readdirSync(oldNasDir).forEach(file => {
                            const src = path.join(oldNasDir, file);
                            const dest = path.join(newNasDir, file);
                            if (!fs.existsSync(dest)) fs.renameSync(src, dest);
                        });
                        fs.rmSync(oldNasDir, { recursive: true, force: true });
                    } else {
                        fs.renameSync(oldNasDir, newNasDir);
                    }
                }
            }
        }

        const updateUrlPath = (doc) => {
            if (oldFolderName !== newFolderName && doc.url) {
                doc.url = doc.url.replace(`/client_master/${oldFolderName}/`, `/client_master/${newFolderName}/`);
                if (doc.path) doc.path = doc.path.replace(`${oldFolderName}`, `${newFolderName}`);
            }
            return doc;
        };

        oldRecord.clientName = clientName;
        oldRecord.refNo = refNo;
        oldRecord.email = email;
        oldRecord.contactPerson = { name: contactPersonName, phone: contactPersonPhone };
        oldRecord.panCard = panCard;
        oldRecord.clientAddress = clientAddress;
        oldRecord.gstNo = gstNo;
        oldRecord.msmeNo = msmeNo;

        // Existing docs update paths
        oldRecord.documents = oldRecord.documents.map(doc => updateUrlPath(doc));

        // New files
        if (files) {
            const processFile = (file, type) => {
                const f = Array.isArray(file) ? file[0] : file;
                // find and remove existing doc of same type if it exists? or just append?
                // logic here is usually replace for GST/MSME
                oldRecord.documents = oldRecord.documents.filter(d => d.type !== type);
                oldRecord.documents.push({
                    name: f.originalname,
                    type,
                    url: `/uploads/client_master/${newFolderName}/${path.basename(f.path)}`,
                    path: f.path
                });
            };
            if (files.gstCert) processFile(files.gstCert, 'GST');
            if (files.msmeCert) processFile(files.msmeCert, 'MSME');
        }

        await oldRecord.save();
        res.json({ success: true, message: 'Client updated successfully', data: oldRecord });
    } catch (error) {
        console.error('Error in updateClientMaster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getClients = async (req, res) => {
    try {
        const clients = await ClientMaster.find().sort({ createdAt: -1 });
        res.json({ success: true, data: clients });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextClientId = async (req, res) => {
    try {
        let counter = await Counter.findById('clientId');
        let nextSeq = counter ? counter.seq + 1 : 1;
        const nextId = `CLNT${String(nextSeq).padStart(6, '0')}`;
        res.json({ success: true, nextId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    storeClientMaster,
    updateClientMaster,
    getClients,
    getNextClientId
};
