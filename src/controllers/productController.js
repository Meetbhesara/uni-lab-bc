const Product = require('../models/Product');
const cloudinary = require('../configs/cloudinary');
const fs = require('fs');

const getUserFromRequest = (req) => {
    // Basic extraction if auth middleware attaches user
    return req.user || null;
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
        const user = getUserFromRequest(req);

        let showPurchasePrice = false;
        if (user && user.id) {
            try {
                const dbUser = await require('../models/User').findById(user.id);
                if (dbUser && dbUser.isAdmin) { // Simplified check based on User.isAdmin field
                    showPurchasePrice = true;
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

        let products = await Product.find(query);

        if (!showPurchasePrice) {
            products = products.map(product => {
                const p = product.toObject();
                delete p.purchasePrice;
                return p;
            });
        }

        res.json(products);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ msg: 'Product not found' });
        }

        const user = getUserFromRequest(req);
        let showPurchasePrice = false;

        if (user && user.id) {
            try {
                const dbUser = await require('../models/User').findById(user.id);
                if (dbUser && dbUser.isAdmin) {
                    showPurchasePrice = true;
                }
            } catch (e) { }
        }

        if (!showPurchasePrice) {
            const p = product.toObject();
            delete p.purchasePrice;
            return res.json(p);
        }

        res.json(product);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.status(500).send('Server Error');
    }
};

const createProduct = async (req, res) => {
    try {
        const { name, description, details, sellingPriceStart, sellingPriceEnd, purchasePrice, dealerPrice, vendor, alternativeNames } = req.body;

        if (!name || !description) {
            return res.status(400).json({ msg: 'Please provide required fields' });
        }

        let images = [];
        let pdf = '';

        if (req.files) {
            if (req.files.images) {
                const imageFiles = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
                const imagePromises = imageFiles.map(file =>
                    uploadToCloudinary(file.path, 'products/images', 'image')
                );
                images = await Promise.all(imagePromises);
            }
            if (req.files.pdf) {
                const pdfFiles = Array.isArray(req.files.pdf) ? req.files.pdf : [req.files.pdf];
                pdf = await uploadToCloudinary(pdfFiles[0].path, 'products/pdfs', 'raw');
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

        const newProduct = new Product({
            name,
            description,
            details: parsedDetails,
            sellingPriceStart,
            sellingPriceEnd,
            purchasePrice,
            dealerPrice,
            vendor,
            alternativeNames: parsedAlternativeNames,
            images,
            pdf
        });

        const product = await newProduct.save();
        res.json(product);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

const updateProduct = async (req, res) => {
    try {
        let product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ msg: 'Product not found' });

        const { name, description, details, alternativeNames } = req.body;

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

        if (name) product.name = name;
        if (description) product.description = description;
        if (sellingPriceStart !== undefined) product.sellingPriceStart = sellingPriceStart;
        if (sellingPriceEnd !== undefined) product.sellingPriceEnd = sellingPriceEnd;
        if (purchasePrice !== undefined) product.purchasePrice = purchasePrice;
        if (dealerPrice !== undefined) product.dealerPrice = dealerPrice;
        if (vendor !== undefined) product.vendor = vendor;

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
        }

        if (req.files) {
            const imageFiles = req.files.images || req.files.photos;
            if (imageFiles) {
                const imgArr = Array.isArray(imageFiles) ? imageFiles : [imageFiles];
                const imagePromises = imgArr.map(file =>
                    uploadToCloudinary(file.path, 'products/images', 'image')
                );
                const newImages = await Promise.all(imagePromises);
                if (!product.images) product.images = [];
                product.images.push(...newImages);
            }
            if (req.files.pdf) {
                const pdfFiles = Array.isArray(req.files.pdf) ? req.files.pdf : [req.files.pdf];
                const pdfUrl = await uploadToCloudinary(pdfFiles[0].path, 'products/pdfs', 'raw');
                product.pdf = pdfUrl;
            }
        }

        await product.save();
        res.json(product);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ msg: 'Product not found' });

        if (product.images && product.images.length > 0) {
            const deletePromises = product.images.map(imageUrl => removeFromCloudinary(imageUrl, 'image'));
            await Promise.all(deletePromises);
        }

        if (product.pdf) {
            await removeFromCloudinary(product.pdf, 'raw');
        }

        await product.deleteOne();
        res.json({ msg: 'Product removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
}

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};
