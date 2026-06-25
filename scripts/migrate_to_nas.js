const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load .env explicitly from D:/uni-bc/.env
require('dotenv').config({ path: 'D:/uni-bc/.env' });

// Native downloader helper (no dependencies needed)
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // clean up file
            reject(err);
        });
    });
};

const runNasMigration = async () => {
    const mongoUri = process.env.MONGO_URL || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ MONGO_URL or MONGO_URI not found in env. Please check D:/uni-bc/.env');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('🔌 MongoDB Connected for NAS Migration...');

        // Get raw collection to bypass Mongoose Schema strictness
        const productCollection = mongoose.connection.db.collection('products');

        const nasBase = process.env.NAS_BASE_PATH || '/app/storage';
        // Clean absolute NAS path
        const absoluteNasBase = path.isAbsolute(nasBase) ? nasBase : path.join('D:/uni-bc', nasBase);

        const targetRoot = path.join(absoluteNasBase, 'products');
        const imagesDir = path.join(targetRoot, 'images');
        const pdfsDir = path.join(targetRoot, 'pdfs');

        // Ensure folders exist
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
        if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });

        const products = await productCollection.find({}).toArray();
        console.log(`📦 Found ${products.length} products to check.`);

        for (const product of products) {
            let localImages = product.localImages || [];
            let localPdf = product.localPdf || '';
            let updated = false;

            // 1. Process Images
            if (product.images && product.images.length > 0) {
                const newLocalImages = [];
                for (const imgUrl of product.images) {
                    if (imgUrl.includes('cloudinary.com')) {
                        try {
                            const fileName = path.basename(imgUrl);
                            const targetPath = path.join(imagesDir, fileName);

                            console.log(`⬇️ [NAS] Downloading Image: ${fileName}`);
                            await downloadFile(imgUrl, targetPath);

                            newLocalImages.push(`/api/uploads/products/images/${fileName}`);
                            updated = true;
                        } catch (err) {
                            console.error(`❌ Failed to download ${imgUrl}:`, err.message);
                            newLocalImages.push(imgUrl); // fallback
                        }
                    } else {
                        newLocalImages.push(imgUrl);
                    }
                }
                localImages = newLocalImages;
            }

            // 2. Process PDF
            if (product.pdf && product.pdf.includes('cloudinary.com')) {
                try {
                    const fileName = path.basename(product.pdf);
                    const targetPath = path.join(pdfsDir, fileName);

                    console.log(`⬇️ [NAS] Downloading PDF: ${fileName}`);
                    await downloadFile(product.pdf, targetPath);

                    localPdf = `/api/uploads/products/pdfs/${fileName}`;
                    updated = true;
                } catch (err) {
                    console.error(`❌ Failed to download PDF ${product.pdf}:`, err.message);
                }
            }

            if (updated) {
                await productCollection.updateOne(
                    { _id: product._id },
                    { $set: { localImages, localPdf } }
                );
                console.log(`✅ Updated Product in MongoDB: ${product.name}`);
            } else {
                console.log(`ℹ️ No Cloudinary images found or already migrated for: ${product.name}`);
            }
        }

        console.log('🎉 NAS Migration completed successfully!');
    } catch (err) {
        console.error('❌ NAS Migration failed:', err);
    } finally {
        mongoose.connection.close();
    }
};

runNasMigration();
