const VehicleMaster = require('../models/VehicleMaster');
const path = require('path');
const { broadcast } = require('../utils/sseManager');

// ─── Subfolder map (must match routes file) ───────────────────────────────────
const PURCHASE_FIELDS = ['purchaseAadharDoc', 'purchasePanDoc'];
const SOLD_FIELDS     = ['sellAadharDoc', 'sellPanDoc'];

const getSubfolder = (fieldname) => {
    if (PURCHASE_FIELDS.includes(fieldname)) return 'purchase';
    if (SOLD_FIELDS.includes(fieldname))     return 'sold';
    return '';
};

// ─── Build a doc reference object from a multer file ─────────────────────────
// URL reflects the actual subfolder the file was saved to.
const makeDoc = (file, folderName) => {
    const sub = getSubfolder(file.fieldname);
    const urlPath = sub
        ? `/uploads/vehicle_master/${folderName}/${sub}/${path.basename(file.path)}`
        : `/uploads/vehicle_master/${folderName}/${path.basename(file.path)}`;
    return { name: file.originalname, url: urlPath, path: file.path };
};

// ─── Safely parse JSON; return fallback on failure ────────────────────────────
const safeParse = (val, fallback = {}) => {
    if (!val) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
};

// ─── Pick first element from multer array or single file ─────────────────────
const first = (f) => (Array.isArray(f) ? f[0] : f);

// ─── CREATE ───────────────────────────────────────────────────────────────────
const storeVehicleMaster = async (req, res) => {
    try {
        const {
            vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate,
            logInName, primaryPhotoName, primaryType,
            purchaseInfo: rawPurchaseInfo,
            sellInfo:     rawSellInfo,
            isSold
        } = req.body;

        const files      = req.files || {};
        const folderName = (vehicleNumber || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        // ── Vehicle identity docs (go in vehicle root folder) ─────────────────
        const rcBookData         = files.rcBook          ? makeDoc(first(files.rcBook),          folderName) : null;
        const insurancePhotoData = files.insurancePhoto  ? makeDoc(first(files.insurancePhoto),  folderName) : null;
        const pucPhotoData       = files.pucPhoto         ? makeDoc(first(files.pucPhoto),        folderName) : null;

        // ── Purchase owner docs  (go in /purchase/ subfolder) ─────────────────
        const purchaseAadharData = files.purchaseAadharDoc ? makeDoc(first(files.purchaseAadharDoc), folderName) : null;
        const purchasePanData    = files.purchasePanDoc    ? makeDoc(first(files.purchasePanDoc),    folderName) : null;

        // ── Sell-out buyer docs  (go in /sold/ subfolder) ─────────────────────
        const sellAadharData = files.sellAadharDoc ? makeDoc(first(files.sellAadharDoc), folderName) : null;
        const sellPanData    = files.sellPanDoc    ? makeDoc(first(files.sellPanDoc),    folderName) : null;

        // ── Vehicle photos (go in vehicle root folder) ────────────────────────
        let vehiclePhotos = [];
        if (files.vehiclePhotos) {
            const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
            vehiclePhotos = flist.map(f => makeDoc(f, folderName));
        }
        // Sort chosen primary photo to index 0
        if (primaryPhotoName && vehiclePhotos.length > 1) {
            const pIdx = vehiclePhotos.findIndex(p => p.name === primaryPhotoName);
            if (pIdx > 0) {
                const pItem = vehiclePhotos[pIdx];
                vehiclePhotos = [pItem, ...vehiclePhotos.filter((_, i) => i !== pIdx)];
            }
        }

        // ── Misc documents ────────────────────────────────────────────────────
        const documents = [];
        if (files.documents) {
            const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
            flist.forEach(f => documents.push({ ...makeDoc(f, folderName), type: f.mimetype }));
        }

        const purchaseInfo = safeParse(rawPurchaseInfo, {});
        const sellInfo     = safeParse(rawSellInfo,     {});

        const record = new VehicleMaster({
            vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName,
            isSold:           isSold === 'true' || isSold === true,
            purchaseInfo,
            purchaseAadharDoc: purchaseAadharData,
            purchasePanDoc:    purchasePanData,
            sellInfo,
            sellAadharDoc: sellAadharData,
            sellPanDoc:    sellPanData,
            rcBook:        rcBookData,
            insurancePhoto: insurancePhotoData,
            pucPhoto:      pucPhotoData,
            vehiclePhotos,
            documents
        });

        await record.save();
        broadcast('vehicle-changed', { action: 'created' });
        res.status(201).json({ success: true, message: 'Saved successfully', data: record });
    } catch (error) {
        console.error('Error in storeVehicleMaster:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ─── READ ALL ─────────────────────────────────────────────────────────────────
const getVehicles = async (req, res) => {
    try {
        const vehicles = await VehicleMaster.find().sort({ createdAt: -1 });
        res.json({ success: true, data: vehicles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
const updateVehicleMaster = async (req, res) => {
    try {
        const _id = req.params.id;
        const {
            vehicleNumber, vehicleName, insuranceDate, pucDate, serviceDate, logInName,
            existingVehiclePhotos, primaryPhotoUrl, primaryPhotoName, primaryType,
            purchaseInfo: rawPurchaseInfo,
            sellInfo:     rawSellInfo,
            isSold
        } = req.body;

        const files  = req.files || {};
        const record = await VehicleMaster.findById(_id);
        if (!record) return res.status(404).json({ success: false, message: 'Vehicle not found' });

        // ── Scalar fields ─────────────────────────────────────────────────────
        if (vehicleNumber !== undefined) record.vehicleNumber = vehicleNumber;
        if (vehicleName   !== undefined) record.vehicleName   = vehicleName;
        if (insuranceDate !== undefined) record.insuranceDate = insuranceDate;
        if (pucDate       !== undefined) record.pucDate       = pucDate;
        if (serviceDate   !== undefined) record.serviceDate   = serviceDate;
        if (logInName     !== undefined) record.logInName     = logInName;
        if (isSold        !== undefined) record.isSold        = isSold === 'true' || isSold === true;

        // ── Nested info objects ───────────────────────────────────────────────
        if (rawPurchaseInfo !== undefined) record.purchaseInfo = safeParse(rawPurchaseInfo, record.purchaseInfo || {});
        if (rawSellInfo     !== undefined) record.sellInfo     = safeParse(rawSellInfo,     record.sellInfo     || {});

        const folderName = (record.vehicleNumber || 'unknown').trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();

        // ── Replace doc files if newly uploaded ───────────────────────────────
        if (files.rcBook)            record.rcBook            = makeDoc(first(files.rcBook),            folderName);
        if (files.insurancePhoto)    record.insurancePhoto    = makeDoc(first(files.insurancePhoto),    folderName);
        if (files.pucPhoto)          record.pucPhoto          = makeDoc(first(files.pucPhoto),          folderName);
        if (files.purchaseAadharDoc) record.purchaseAadharDoc = makeDoc(first(files.purchaseAadharDoc), folderName); // → /purchase/
        if (files.purchasePanDoc)    record.purchasePanDoc    = makeDoc(first(files.purchasePanDoc),    folderName); // → /purchase/
        if (files.sellAadharDoc)     record.sellAadharDoc     = makeDoc(first(files.sellAadharDoc),     folderName); // → /sold/
        if (files.sellPanDoc)        record.sellPanDoc        = makeDoc(first(files.sellPanDoc),        folderName); // → /sold/

        if (files.documents) {
            const flist = Array.isArray(files.documents) ? files.documents : [files.documents];
            flist.forEach(f => record.documents.push({ ...makeDoc(f, folderName), type: f.mimetype }));
        }

        // ── Reconcile existing vehicle photos ─────────────────────────────────
        let parsedExisting = [];
        if (existingVehiclePhotos !== undefined) {
            parsedExisting = safeParse(existingVehiclePhotos, []);
            if (!Array.isArray(parsedExisting)) parsedExisting = [parsedExisting];
        }

        let updatedExistingList = [];
        if (existingVehiclePhotos !== undefined) {
            parsedExisting.forEach(url => {
                const found = (record.vehiclePhotos || []).find(p => p.url === url || (p.url && p.url.endsWith(url)));
                updatedExistingList.push(found || { name: path.basename(url), url });
            });
        } else {
            updatedExistingList = record.vehiclePhotos || [];
        }

        // ── New vehicle photos uploaded ────────────────────────────────────────
        let newUploadedList = [];
        if (files.vehiclePhotos) {
            const flist = Array.isArray(files.vehiclePhotos) ? files.vehiclePhotos : [files.vehiclePhotos];
            newUploadedList = flist.map(f => makeDoc(f, folderName));
        }

        // ── Reorder — primary at index 0 ──────────────────────────────────────
        let finalPhotos = [];
        if (primaryType === 'new' || (primaryPhotoName && newUploadedList.some(p => p.name === primaryPhotoName))) {
            if (primaryPhotoName) {
                const pIdx = newUploadedList.findIndex(p => p.name === primaryPhotoName);
                if (pIdx > 0) {
                    const pItem = newUploadedList[pIdx];
                    newUploadedList = [pItem, ...newUploadedList.filter((_, i) => i !== pIdx)];
                }
            }
            finalPhotos = [...newUploadedList, ...updatedExistingList];
        } else {
            if (primaryPhotoUrl && updatedExistingList.length > 0) {
                const pIdx = updatedExistingList.findIndex(p => p.url === primaryPhotoUrl || (p.url && p.url.endsWith(primaryPhotoUrl)));
                if (pIdx > 0) {
                    const pItem = updatedExistingList[pIdx];
                    updatedExistingList = [pItem, ...updatedExistingList.filter((_, i) => i !== pIdx)];
                }
            }
            finalPhotos = [...updatedExistingList, ...newUploadedList];
        }

        record.vehiclePhotos = finalPhotos;

        await record.save();
        broadcast('vehicle-changed', { action: 'updated' });
        res.json({ success: true, message: 'Updated successfully', data: record });
    } catch (error) {
        console.error('Error in updateVehicleMaster:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
const deleteVehicleMaster = async (req, res) => {
    try {
        const record = await VehicleMaster.findByIdAndDelete(req.params.id);
        if (!record) return res.status(404).json({ success: false, message: 'Vehicle not found' });
        broadcast('vehicle-changed', { action: 'deleted' });
        res.json({ success: true, message: 'Vehicle deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { storeVehicleMaster, getVehicles, updateVehicleMaster, deleteVehicleMaster };