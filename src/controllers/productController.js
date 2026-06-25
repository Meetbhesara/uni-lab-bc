const Product = require('../models/Product');
const cloudinary = require('../configs/cloudinary');
const fs = require('fs');
const path = require('path');

const getUserFromRequest = (req) => {
    // Basic extraction if auth middleware attaches user
    return req.user || null;
};

// ... Local & NAS Storage Helpers ...
const useNasFlag = process.env.USE_NAS;
let nasRoot = process.env.NAS_BASE_PATH || '/app/storage';
if (useNasFlag === 'true' && !nasRoot.startsWith('/')) {
    nasRoot = '/' + nasRoot;
}
const localRoot = process.env.LOCAL_BASE_PATH || './uploads';

// Resolve products base path
let productsUploadPath;
if (useNasFlag === 'true') {
    productsUploadPath = path.join(nasRoot, 'products');
} else {
    productsUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'products')
        : path.join(process.cwd(), localRoot, 'products');
}

const saveLocalFile = (file, subfolder) => {
    const destDir = path.join(productsUploadPath, subfolder);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    const fileName = file.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    const destPath = path.join(destDir, fileName);
    
    try {
        fs.renameSync(file.path, destPath);
    } catch (err) {
        if (err.code === 'EXDEV') {
            fs.copyFileSync(file.path, destPath);
            fs.unlinkSync(file.path);
        } else {
            throw err;
        }
    }
    
    return `/api/uploads/products/${subfolder}/${fileName}`;
};

const removeLocalFile = (relativePath) => {
    if (!relativePath || relativePath.startsWith('http')) return;
    try {
        const parts = relativePath.split('/api/uploads/products/');
        if (parts.length === 2) {
            const filePath = path.join(productsUploadPath, parts[1]);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted local file: ${filePath}`);
            }
        }
    } catch (err) {
        console.error('Error removing local file:', err);
    }
};

// ... Helper Functions ...
const uploadToCloudinary = async (filePath, folder, resourceType = 'image') => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: folder,
            resource_type: resourceType,
            use_filename: true,
            unique_filename: false
        });
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return result.secure_url;
    } catch (error) {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        throw error;
    }
};

const getPublicIdFromUrl = (url) => {
    if (!url) return null;
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    return filename.split('.')[0];
};

const removeFromCloudinary = async (url, resourceType = 'image') => {
    try {
        const publicId = getPublicIdFromUrl(url);
        if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        }
    } catch (error) {
        console.error('Error removing from Cloudinary:', error);
    }
};

// ... Controller Functions ...

const getProducts = async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};

        // MANUALLY CHECK AUTH TOKEN SINCE ROUTE IS PUBLIC
        let user = null;
        const tokenHeader = req.header('x-auth-token') || req.header('Authorization');
        if (tokenHeader) {
            try {
                let token = tokenHeader;
                if (tokenHeader.startsWith('Bearer ')) {
                    token = tokenHeader.slice(7, tokenHeader.length).trimLeft();
                }
                if (token) {
                    const jwt = require('jsonwebtoken'); // Lazy load
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    user = decoded.user || decoded; // Handle different payload structures
                }
            } catch (e) {
                // Token invalid or expired, just treat as guest
            }
        }

        let showPurchasePrice = false;
        let showStock = false;
        if (user && user.id) {
            try {
                const dbUser = await require('../models/User').findById(user.id);
                if (dbUser && dbUser.isAdmin) {
                    showPurchasePrice = true;
                    // Check if they have the specific showStock read permission, or if they are superAdmin or legacy admin
                    if (dbUser.isSuperAdmin) {
                        showStock = true;
                    } else if (dbUser.permissions && dbUser.permissions.showStock) {
                        showStock = !!dbUser.permissions.showStock.read;
                    } else {
                        // Legacy admin defaults to true
                        showStock = true;
                    }
                }
            } catch (e) { }
        }

        if (search) {
            query = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { alternativeNames: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const { category } = req.query;
        if (category && category !== 'All' && category !== 'undefined' && category !== 'null') {
            query.category = { $regex: new RegExp(`^${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
        } else if (!showPurchasePrice) {
            // For public users browsing/searching, only fetch products that have properly been assigned a category
            query.category = { $exists: true, $type: 'string', $nin: ['', 'undefined', 'null'] };
        }

        let products = await Product.find(query);

        products = products.map(product => {
            // Flatten Maps (details) to ensure they appear as Objects in JSON
            const p = product.toObject({ getters: true, virtuals: false, flattenMaps: true });
            if (!showPurchasePrice) {
                delete p.purchasePrice;
                delete p.vendors;
            }
            if (!showStock) {
                delete p.stock;
            }
            return p;
        });

        res.json(products);
    } catch (err) {
        console.error('❌ Error in getProducts:', err);
        res.status(500).json({ success: false, message: err.message || 'Server Error' });
    }
};

const getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ msg: 'Product not found' });
        }

        // MANUALLY CHECK AUTH TOKEN SINCE ROUTE IS PUBLIC
        let user = null;
        const tokenHeader = req.header('x-auth-token') || req.header('Authorization');
        if (tokenHeader) {
            try {
                let token = tokenHeader;
                if (tokenHeader.startsWith('Bearer ')) {
                    token = tokenHeader.slice(7, tokenHeader.length).trimLeft();
                }
                if (token) {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    user = decoded.user || decoded;
                }
            } catch (e) { }
        }

        let showPurchasePrice = false;
        let showStock = false;

        if (user && user.id) {
            try {
                const dbUser = await require('../models/User').findById(user.id);
                if (dbUser && dbUser.isAdmin) {
                    showPurchasePrice = true;
                    if (dbUser.isSuperAdmin) {
                        showStock = true;
                    } else if (dbUser.permissions && dbUser.permissions.showStock) {
                        showStock = !!dbUser.permissions.showStock.read;
                    } else {
                        showStock = true;
                    }
                }
            } catch (e) { }
        }

        // Always flatten Maps for consistency
        const p = product.toObject({ getters: true, virtuals: false, flattenMaps: true });

        if (!showPurchasePrice) {
            delete p.purchasePrice;
            delete p.vendors;
        }
        if (!showStock) {
            delete p.stock;
        }

        res.json(p);
    } catch (err) {
        console.error('❌ Error in getProductById:', err);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.status(500).json({ success: false, message: err.message || 'Server Error' });
    }
};

const createProduct = async (req, res) => {
    console.log('🚀 Backend [createProduct] request received');
    console.log('Payload body:', req.body);
    console.log('Uploaded files:', req.files);
    try {
        const { name, description, category, details, sellingPriceStart, sellingPriceEnd, purchasePrice, dealerPrice, vendor, vendors, alternativeNames, stock, videoLinks } = req.body;

        if (!name || !description || !category) {
            console.warn('⚠️ Validation failed: Missing required fields (name, description, category)');
            return res.status(400).json({ msg: 'Please provide required fields: name, description, category' });
        }

        let images = [];
        let pdf = '';
        let localImages = [];
        let localPdf = '';
        let localVideos = [];

        if (req.files) {
            const imgFiles = req.files.images || req.files.photos;
            if (imgFiles) {
                const imageFiles = Array.isArray(imgFiles) ? imgFiles : [imgFiles];
                const localPromises = imageFiles.map(file => saveLocalFile(file, 'images'));
                localImages = await Promise.all(localPromises);
                images = localImages;
            }
            if (req.files.pdf) {
                const pdfFiles = Array.isArray(req.files.pdf) ? req.files.pdf : [req.files.pdf];
                localPdf = saveLocalFile(pdfFiles[0], 'pdfs');
                pdf = localPdf;
            }
            if (req.files.videos) {
                const videoFiles = Array.isArray(req.files.videos) ? req.files.videos : [req.files.videos];
                const localPromises = videoFiles.map(file => saveLocalFile(file, 'videos'));
                localVideos = await Promise.all(localPromises);
            }
        }

        let parsedVideoLinks = [];
        if (videoLinks) {
            if (typeof videoLinks === 'string') {
                try {
                    parsedVideoLinks = JSON.parse(videoLinks);
                } catch (e) {
                    parsedVideoLinks = [videoLinks];
                }
            } else if (Array.isArray(videoLinks)) {
                parsedVideoLinks = videoLinks;
            }
        }

        let parsedAlternativeNames = [];
        if (alternativeNames) {
            if (typeof alternativeNames === 'string') {
                try {
                    parsedAlternativeNames = JSON.parse(alternativeNames);
                } catch (e) {
                    parsedAlternativeNames = [alternativeNames];
                }
            } else if (Array.isArray(alternativeNames)) {
                parsedAlternativeNames = alternativeNames;
            }
        }

        let parsedDetails = details;
        if (details && typeof details === 'string') {
            try {
                parsedDetails = JSON.parse(details);
            } catch (e) {
                console.error('Error parsing details:', e);
            }
        }

        let parsedVendors = [];
        if (vendors) {
            if (typeof vendors === 'string') {
                try {
                    parsedVendors = JSON.parse(vendors);
                } catch (e) {
                    console.error('Error parsing vendors:', e);
                }
            } else if (Array.isArray(vendors)) {
                parsedVendors = vendors;
            }
        }

        let parsedStock = 0;
        if (stock !== undefined && stock !== null && stock !== '') {
            parsedStock = Number(stock);
            if (isNaN(parsedStock) || parsedStock < 0) {
                return res.status(400).json({ msg: 'Stock must be a non-negative number' });
            }
        }

        const newProduct = new Product({
            name,
            description,
            category,
            details: parsedDetails,
            sellingPriceStart,
            sellingPriceEnd,
            purchasePrice,
            dealerPrice,
            vendor,
            vendors: parsedVendors,
            alternativeNames: parsedAlternativeNames,
            images,
            pdf,
            localImages,
            localPdf,
            localVideos,
            videoLinks: parsedVideoLinks,
            stock: parsedStock
        });

        const product = await newProduct.save();
        console.log('✅ createProduct SUCCESS:', { productId: product._id, name: product.name });
        res.json(product);
    } catch (err) {
        console.error('❌ Error in createProduct:', err);
        res.status(500).json({ success: false, message: err.message || 'Server Error' });
    }
};

const updateProduct = async (req, res) => {
    console.log(`🚀 Backend [updateProduct] request received for ID: ${req.params.id}`);
    console.log('Payload body:', req.body);
    console.log('Uploaded files:', req.files);
    try {
        let product = await Product.findById(req.params.id);
        if (!product) {
            console.warn(`⚠️ Product not found with ID: ${req.params.id}`);
            return res.status(404).json({ msg: 'Product not found' });
        }

        const { name, description, category, details, alternativeNames, vendors, videoLinks } = req.body;

        // Helper to clean numbers
        const cleanNumber = (val) => {
            if (val === '' || val === null || val === undefined) return undefined;
            return val;
        };

        const sellingPriceStart = cleanNumber(req.body.sellingPriceStart);
        const sellingPriceEnd = cleanNumber(req.body.sellingPriceEnd);
        const purchasePrice = cleanNumber(req.body.purchasePrice);
        const dealerPrice = cleanNumber(req.body.dealerPrice);
        const vendor = req.body.vendor;
        const stock = cleanNumber(req.body.stock);

        if (name) product.name = name;
        if (description) product.description = description;
        if (category) product.category = category;
        if (sellingPriceStart !== undefined) product.sellingPriceStart = sellingPriceStart;
        if (sellingPriceEnd !== undefined) product.sellingPriceEnd = sellingPriceEnd;
        if (purchasePrice !== undefined) product.purchasePrice = purchasePrice;
        if (dealerPrice !== undefined) product.dealerPrice = dealerPrice;
        if (vendor !== undefined) product.vendor = vendor;
        if (stock !== undefined) {
            const parsedStock = Number(stock);
            if (isNaN(parsedStock) || parsedStock < 0) {
                return res.status(400).json({ msg: 'Stock must be a non-negative number' });
            }
            product.stock = parsedStock;
        }

        if (vendors !== undefined) {
            let parsedVendors = vendors;
            if (typeof vendors === 'string') {
                try {
                    parsedVendors = JSON.parse(vendors);
                } catch (e) {
                    parsedVendors = [];
                }
            }
            product.vendors = parsedVendors;
        }

        if (alternativeNames !== undefined) {
            let parsedAlternativeNames = alternativeNames;
            if (typeof alternativeNames === 'string') {
                try {
                    if (alternativeNames.trim().startsWith('[')) {
                        parsedAlternativeNames = JSON.parse(alternativeNames);
                    } else {
                        parsedAlternativeNames = [alternativeNames];
                    }
                } catch (e) {
                    parsedAlternativeNames = [];
                }
            }
            product.alternativeNames = parsedAlternativeNames;
        }

        if (details) {
            let parsedDetails = details;
            if (typeof details === 'string') {
                try {
                    parsedDetails = JSON.parse(details);
                } catch (e) {
                    console.error('Error parsing details for update:', e);
                }
            }
            product.details = parsedDetails;
            product.markModified('details');
        }

        if (videoLinks !== undefined) {
            let parsedVideoLinks = videoLinks;
            if (typeof videoLinks === 'string') {
                try {
                    if (videoLinks.trim().startsWith('[')) {
                        parsedVideoLinks = JSON.parse(videoLinks);
                    } else {
                        parsedVideoLinks = [videoLinks];
                    }
                } catch (e) {
                    parsedVideoLinks = [];
                }
            }
            product.videoLinks = parsedVideoLinks;
        }

        let currentImages = [];
        if (req.body.existingPhotos) {
            currentImages = Array.isArray(req.body.existingPhotos)
                ? req.body.existingPhotos
                : [req.body.existingPhotos];
        } else if (!req.files || !(req.files.images || req.files.photos)) {
            // currentImages = []; // Comment logic from orig file
        } else {
            currentImages = product.images || [];
        }

        // Fix logic: if existingPhotos is present, use it. Else append? logic was complex.
        // Assuming if existingPhotos is NOT sent, we keep existing images unless explicit delete?
        // Let's stick to simple append if no existingPhotos logic provided, OR keep as is.
        // Original logic: if existingPhotos param exists, that's the new list (minus deleted). New uploads are appended.
        // If existingPhotos NOT exists but we have files, we might be appending.

        if (req.body.existingPhotos) {
            product.images = currentImages;
            product.localImages = currentImages;
        }

        let currentVideos = [];
        if (req.body.existingVideos) {
            currentVideos = Array.isArray(req.body.existingVideos)
                ? req.body.existingVideos
                : [req.body.existingVideos];
            product.localVideos = currentVideos;
        }

        if (req.files) {
            const imageFiles = req.files.images || req.files.photos;
            if (imageFiles) {
                const imgArr = Array.isArray(imageFiles) ? imageFiles : [imageFiles];
                const localPromises = imgArr.map(file => saveLocalFile(file, 'images'));
                const newImages = await Promise.all(localPromises);
                if (!product.images) product.images = [];
                product.images.push(...newImages);
                if (!product.localImages) product.localImages = [];
                product.localImages.push(...newImages);
            }
            if (req.files.pdf) {
                const pdfFiles = Array.isArray(req.files.pdf) ? req.files.pdf : [req.files.pdf];
                const localPdfUrl = saveLocalFile(pdfFiles[0], 'pdfs');
                product.pdf = localPdfUrl;
                product.localPdf = localPdfUrl;
            }
            if (req.files.videos) {
                const videoFiles = Array.isArray(req.files.videos) ? req.files.videos : [req.files.videos];
                const localPromises = videoFiles.map(file => saveLocalFile(file, 'videos'));
                const newVideos = await Promise.all(localPromises);
                if (!product.localVideos) product.localVideos = [];
                product.localVideos.push(...newVideos);
            }
        }

        await product.save();
        console.log(`✅ updateProduct SUCCESS for ID: ${req.params.id}`, { name: product.name });
        res.json(product);

    } catch (err) {
        console.error('❌ Error in updateProduct:', err);
        res.status(500).json({ success: false, message: err.message || 'Server Error' });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ msg: 'Product not found' });

        if (product.images && product.images.length > 0) {
            const deletePromises = product.images.map(imageUrl => {
                if (imageUrl.includes('cloudinary.com')) {
                    return removeFromCloudinary(imageUrl, 'image');
                } else {
                    removeLocalFile(imageUrl);
                }
            });
            await Promise.all(deletePromises);
        }

        if (product.pdf) {
            if (product.pdf.includes('cloudinary.com')) {
                await removeFromCloudinary(product.pdf, 'raw');
            } else {
                removeLocalFile(product.pdf);
            }
        }

        if (product.localImages && product.localImages.length > 0) {
            product.localImages.forEach(img => removeLocalFile(img));
        }

        if (product.localPdf) {
            removeLocalFile(product.localPdf);
        }

        if (product.localVideos && product.localVideos.length > 0) {
            product.localVideos.forEach(vid => removeLocalFile(vid));
        }

        await product.deleteOne();
        res.json({ msg: 'Product removed' });
    } catch (err) {
        console.error('❌ Error in deleteProduct:', err);
        res.status(500).json({ success: false, message: err.message || 'Server Error' });
    }
}

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};
