const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const verifyAdmin = require('../middlewares/verifyAdmin');
const upload = require('../middlewares/upload');

// Configure upload fields
const cpUpload = upload.fields([{ name: 'images', maxCount: 10 }, { name: 'pdf', maxCount: 1 }, { name: 'photos', maxCount: 10 }]);

router.get('/', productController.getProducts);
router.get('/:id', productController.getProductById);

router.post('/', verifyAdmin, cpUpload, productController.createProduct);
router.put('/:id', verifyAdmin, cpUpload, productController.updateProduct);
router.delete('/:id', verifyAdmin, productController.deleteProduct);

module.exports = router;
