const dotenv = require('dotenv').config();
const exprees = require('express');
const app = exprees();
const connectDB = require('./configs/db');
const authRoutes = require('./routes/authRoutes');
const cors = require('cors');
app.use(cors());
connectDB();

app.use('/uploads', exprees.static('uploads'));
app.use(exprees.json({ extended: false }));

const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const quotationRoutes = require('./routes/quotationRoutes');
const enquiryRoutes = require('./routes/enquiryRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const { initialize: initializeWhatsapp } = require('./utils/whatsappService');

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api', uploadRoutes);

// Initialize WhatsApp client
initializeWhatsapp();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
