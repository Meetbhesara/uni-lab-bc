const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Auto-detect backend .env across Synology NAS, Docker, and Local Windows
const candidateEnvPaths = [
    '/volume1/docker/myapp/uni-lab-bc/.env',
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
    'D:/uni-bc/.env',
    '../uni-bc/.env'
];

let envPath = null;
let envVars = {};

for (const p of candidateEnvPaths) {
    if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = {};
        raw.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [k, ...v] = trimmed.split('=');
                parsed[k.trim()] = v.join('=').trim();
            }
        });
        // Prioritize backend .env (contains MONGO_URL)
        if (parsed.MONGO_URL) {
            envPath = p;
            envVars = parsed;
            break;
        } else if (!envPath) {
            envPath = p;
            envVars = parsed;
        }
    }
}

if (envPath) {
    console.log(`📄 Loaded backend configuration from: ${envPath}`);
} else {
    console.warn('⚠️ No .env file found in candidate paths. Using process.env fallback.');
}

const MONGO_URL = envVars.MONGO_URL || process.env.MONGO_URL;
const USE_NAS = (envVars.USE_NAS || process.env.USE_NAS) === 'true';
const NAS_BASE = envVars.NAS_BASE_PATH || process.env.NAS_BASE_PATH || '/app/storage';
const LOCAL_BASE = envVars.LOCAL_BASE_PATH || process.env.LOCAL_BASE_PATH || './uploads';

// Resolve base directory dynamically
let baseUploadDir;
if (USE_NAS) {
    baseUploadDir = path.join(NAS_BASE.startsWith('/') ? NAS_BASE : '/' + NAS_BASE, 'instrument_master');
} else {
    const rootDir = envPath ? path.dirname(envPath) : process.cwd();
    const absLocal = path.isAbsolute(LOCAL_BASE) ? LOCAL_BASE : path.join(rootDir, LOCAL_BASE);
    baseUploadDir = path.join(absLocal, 'instrument_master');
}

// Helper to sanitize folder names: [serialNo]-[instrumentName]
const sanitizeName = (serialNo, instName, model) => {
    const p1 = (serialNo || 'no_serial').trim();
    const p2 = (instName || model || 'instrument').trim();
    return `${p1}-${p2}`.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
};

// Check if running in execute mode
const isExecute = process.argv.includes('--execute');

async function runMigration() {
    console.log('================================================================');
    console.log(`🚀 INSTRUMENT MASTER FOLDER & MONGODB MIGRATION TOOL`);
    console.log(`MODE: ${isExecute ? '🔴 LIVE EXECUTION (--execute)' : '🟡 DRY RUN PREVIEW (No files or DB modified)'}`);
    console.log(`STORAGE TARGET: ${USE_NAS ? 'NAS Mode (' + baseUploadDir + ')' : 'Local Disk (' + baseUploadDir + ')'}`);
    console.log('================================================================\n');

    if (!MONGO_URL) {
        console.error('❌ MONGO_URL is missing! Please ensure MONGO_URL is set in .env.');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URL);
    console.log('✅ Connected to MongoDB successfully.\n');

    // Load InstrumentMaster schema
    const InstrumentMaster = mongoose.models.InstrumentMaster || mongoose.model('InstrumentMaster', new mongoose.Schema({
        serialNo: String,
        instrumentName: String,
        model: String,
        parentInstrumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'InstrumentMaster' },
        photo: Object,
        photos: Array,
        notes: String
    }, { timestamps: true }));

    const allInstruments = await InstrumentMaster.find().lean();
    console.log(`Found ${allInstruments.length} total instrument records in database.\n`);

    const parents = allInstruments.filter(i => !i.parentInstrumentId);
    const children = allInstruments.filter(i => !i.parentInstrumentId ? false : true);

    console.log(`🔹 Parent / Standalone Instruments: ${parents.length}`);
    console.log(`🔹 Child Accessory Instruments: ${children.length}\n`);

    let foldersRenamed = 0;
    let recordsUpdated = 0;
    let errorsCount = 0;

    // Track new folder names of parents so children can be placed inside them
    const parentFolderMap = new Map();

    // =========================================================================
    // STEP 1: Process Parents & Standalone Units
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('STEP 1: Processing Parent & Standalone Instruments');
    console.log('----------------------------------------------------------------');

    for (const parent of parents) {
        const newFolder = sanitizeName(parent.serialNo, parent.instrumentName, parent.model);
        parentFolderMap.set(String(parent._id), newFolder);

        const newDirPath = path.join(baseUploadDir, newFolder);
        console.log(`\n📌 Parent: [${parent.serialNo}] "${parent.instrumentName || 'Unnamed'}" (${parent.model || 'No Model'})`);
        console.log(`   Target Folder: ${newFolder}`);

        // Detect old folder from existing photos
        let oldFolder = null;
        const allParentPhotos = parent.photos || (parent.photo ? [parent.photo] : []);
        
        for (const p of allParentPhotos) {
            if (p && p.url) {
                const parts = p.url.replace(/\\/g, '/').split('/instrument_master/');
                if (parts[1]) {
                    const subparts = parts[1].split('/').filter(Boolean);
                    if (subparts.length >= 2) {
                        oldFolder = subparts[0];
                        break;
                    }
                }
            }
        }

        // If no old folder detected from photos, try legacy pattern: serialNo_model or serialNo-model
        if (!oldFolder) {
            const legacy1 = `${parent.serialNo || ''}_${parent.model || ''}`.replace(/[/\\:*?"<>|]/g, '_').toLowerCase();
            const legacy2 = `${parent.serialNo || ''}-${parent.model || ''}`.replace(/[/\\:*?"<>|]/g, '_').toLowerCase();
            if (fs.existsSync(path.join(baseUploadDir, legacy1))) oldFolder = legacy1;
            else if (fs.existsSync(path.join(baseUploadDir, legacy2))) oldFolder = legacy2;
        }

        // Perform Folder Rename / Move if needed
        if (oldFolder && oldFolder !== newFolder) {
            const oldDirPath = path.join(baseUploadDir, oldFolder);
            console.log(`   Old Folder on Disk: ${oldFolder}`);

            if (fs.existsSync(oldDirPath)) {
                console.log(`   Action: Rename disk folder "${oldFolder}" ➔ "${newFolder}"`);
                if (isExecute) {
                    try {
                        if (!fs.existsSync(newDirPath)) {
                            fs.renameSync(oldDirPath, newDirPath);
                            foldersRenamed++;
                        } else {
                            const files = fs.readdirSync(oldDirPath);
                            for (const f of files) {
                                const srcFile = path.join(oldDirPath, f);
                                const dstFile = path.join(newDirPath, f);
                                if (!fs.existsSync(dstFile)) fs.renameSync(srcFile, dstFile);
                            }
                            fs.rmdirSync(oldDirPath);
                            foldersRenamed++;
                        }
                    } catch (err) {
                        console.error(`   ❌ Failed to rename folder: ${err.message}`);
                        errorsCount++;
                    }
                }
            } else {
                console.log(`   ⚠️  Old folder not found on disk (no physical files).`);
            }
        } else {
            console.log(`   Folder status: Already aligned or no rename required.`);
        }

        // Update MongoDB photo URLs & paths
        let updatedPhotos = [];
        let updatedPrimaryPhoto = null;
        let needsDbUpdate = false;

        if (parent.photos && parent.photos.length > 0) {
            updatedPhotos = parent.photos.map(p => {
                if (!p || !p.url) return p;
                const fileName = path.basename(p.url.replace(/\\/g, '/'));
                const newUrl = `/uploads/instrument_master/${newFolder}/${fileName}`;
                const newPath = path.join(baseUploadDir, newFolder, fileName).replace(/\\/g, '/');
                if (p.url !== newUrl) needsDbUpdate = true;
                return {
                    ...p,
                    url: newUrl,
                    path: newPath
                };
            });
        }

        if (parent.photo && parent.photo.url) {
            const fileName = path.basename(parent.photo.url.replace(/\\/g, '/'));
            const newUrl = `/uploads/instrument_master/${newFolder}/${fileName}`;
            const newPath = path.join(baseUploadDir, newFolder, fileName).replace(/\\/g, '/');
            if (parent.photo.url !== newUrl) needsDbUpdate = true;
            updatedPrimaryPhoto = {
                ...parent.photo,
                url: newUrl,
                path: newPath
            };
        } else if (updatedPhotos.length > 0) {
            updatedPrimaryPhoto = updatedPhotos[0];
            needsDbUpdate = true;
        }

        if (needsDbUpdate) {
            console.log(`   MongoDB URLs ➔ /uploads/instrument_master/${newFolder}/<filename>`);
            if (isExecute) {
                await InstrumentMaster.findByIdAndUpdate(parent._id, {
                    $set: {
                        photos: updatedPhotos,
                        photo: updatedPrimaryPhoto
                    }
                });
                recordsUpdated++;
            }
        } else {
            console.log(`   MongoDB records already up to date.`);
        }
    }

    // =========================================================================
    // STEP 2: Process Child Accessories (Nested directly inside Parent)
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('STEP 2: Processing Child Accessories (Nesting inside Parent)');
    console.log('----------------------------------------------------------------');

    for (const child of children) {
        const parentFolder = parentFolderMap.get(String(child.parentInstrumentId)) || 'unassigned_parent';
        const childFolder = sanitizeName(child.serialNo, child.instrumentName, child.model);
        const targetNestedRelative = `${parentFolder}/${childFolder}`;
        const targetNestedDirPath = path.join(baseUploadDir, parentFolder, childFolder);

        console.log(`\n📌 Child: [${child.serialNo}] "${child.instrumentName || 'Unnamed'}" (${child.model || 'No Model'})`);
        console.log(`   Parent Unit: ${parentFolder}`);
        console.log(`   Nested Target: ${targetNestedRelative}`);

        // Detect old child folder from existing photos
        let oldChildRelative = null;
        const allChildPhotos = child.photos || (child.photo ? [child.photo] : []);
        for (const p of allChildPhotos) {
            if (p && p.url) {
                const parts = p.url.replace(/\\/g, '/').split('/instrument_master/');
                if (parts[1]) {
                    const subparts = parts[1].split('/').filter(Boolean);
                    if (subparts.length >= 3) {
                        oldChildRelative = `${subparts[0]}/${subparts[1]}`;
                        break;
                    } else if (subparts.length === 2) {
                        oldChildRelative = subparts[0];
                        break;
                    }
                }
            }
        }

        // If old folder is standalone (at root of instrument_master), move it directly into parent folder
        if (oldChildRelative && oldChildRelative !== targetNestedRelative) {
            const oldDirPath = path.join(baseUploadDir, oldChildRelative);
            console.log(`   Old Location: ${oldChildRelative}`);

            if (fs.existsSync(oldDirPath) && oldDirPath !== targetNestedDirPath) {
                console.log(`   Action: Move folder "${oldChildRelative}" ➔ "${targetNestedRelative}"`);
                if (isExecute) {
                    try {
                        const parentDirPath = path.join(baseUploadDir, parentFolder);
                        if (!fs.existsSync(parentDirPath)) fs.mkdirSync(parentDirPath, { recursive: true });
                        
                        if (!fs.existsSync(targetNestedDirPath)) {
                            fs.renameSync(oldDirPath, targetNestedDirPath);
                            foldersRenamed++;
                        } else {
                            const files = fs.readdirSync(oldDirPath);
                            for (const f of files) {
                                const srcFile = path.join(oldDirPath, f);
                                const dstFile = path.join(targetNestedDirPath, f);
                                if (!fs.existsSync(dstFile)) fs.renameSync(srcFile, dstFile);
                            }
                            fs.rmdirSync(oldDirPath);
                            foldersRenamed++;
                        }
                    } catch (err) {
                        console.error(`   ❌ Failed to move child folder: ${err.message}`);
                        errorsCount++;
                    }
                }
            } else {
                console.log(`   ⚠️  Old child folder not found on disk.`);
            }
        } else {
            console.log(`   Folder status: Already aligned in nested parent folder.`);
        }

        // Update MongoDB child URLs & paths
        let updatedChildPhotos = [];
        let updatedChildPrimaryPhoto = null;
        let needsChildDbUpdate = false;

        if (child.photos && child.photos.length > 0) {
            updatedChildPhotos = child.photos.map(p => {
                if (!p || !p.url) return p;
                const fileName = path.basename(p.url.replace(/\\/g, '/'));
                const newUrl = `/uploads/instrument_master/${parentFolder}/${childFolder}/${fileName}`;
                const newPath = path.join(baseUploadDir, parentFolder, childFolder, fileName).replace(/\\/g, '/');
                if (p.url !== newUrl) needsChildDbUpdate = true;
                return {
                    ...p,
                    url: newUrl,
                    path: newPath
                };
            });
        }

        if (child.photo && child.photo.url) {
            const fileName = path.basename(child.photo.url.replace(/\\/g, '/'));
            const newUrl = `/uploads/instrument_master/${parentFolder}/${childFolder}/${fileName}`;
            const newPath = path.join(baseUploadDir, parentFolder, childFolder, fileName).replace(/\\/g, '/');
            if (child.photo.url !== newUrl) needsChildDbUpdate = true;
            updatedChildPrimaryPhoto = {
                ...child.photo,
                url: newUrl,
                path: newPath
            };
        } else if (updatedChildPhotos.length > 0) {
            updatedChildPrimaryPhoto = updatedChildPhotos[0];
            needsChildDbUpdate = true;
        }

        if (needsChildDbUpdate) {
            console.log(`   MongoDB URLs ➔ /uploads/instrument_master/${parentFolder}/${childFolder}/<filename>`);
            if (isExecute) {
                await InstrumentMaster.findByIdAndUpdate(child._id, {
                    $set: {
                        photos: updatedChildPhotos,
                        photo: updatedChildPrimaryPhoto
                    }
                });
                recordsUpdated++;
            }
        } else {
            console.log(`   MongoDB child records already up to date.`);
        }
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n================================================================');
    console.log('MIGRATION SUMMARY REPORT');
    console.log('================================================================');
    console.log(`Mode: ${isExecute ? '🔴 LIVE EXECUTION COMPLETED' : '🟡 DRY RUN PREVIEW COMPLETED'}`);
    console.log(`Folders ${isExecute ? 'Renamed/Moved' : 'to Rename/Move'}: ${foldersRenamed}`);
    console.log(`MongoDB Records ${isExecute ? 'Updated' : 'to Update'}: ${recordsUpdated}`);
    console.log(`Errors Encountered: ${errorsCount}`);
    console.log('================================================================\n');

    if (!isExecute) {
        console.log('💡 TIP: Review the preview above. To apply these changes live, run:');
        console.log('   node migrate_instrument_folders.cjs --execute\n');
    }

    await mongoose.disconnect();
}

runMigration().catch(err => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
});
