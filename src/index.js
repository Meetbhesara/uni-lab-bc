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
const vehicleMasterRoutes = require('./routes/vehicleMasterRoutes');
const employeeMasterRoutes = require('./routes/employeeMasterRoutes');
const clientMasterRoutes = require('./routes/clientMasterRoutes');
const siteMasterRoutes = require('./routes/siteMasterRoutes');
const scheduleMasterRoutes = require('./routes/scheduleMasterRoutes');
const instrumentMasterRoutes = require('./routes/instrumentMasterRoutes');
const employeeAuthRoutes = require('./routes/employeeAuthRoutes');
const employeeExpenseRoutes = require('./routes/employeeExpenseRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const path = require('path');
const fs = require('fs');
const { initialize: initializeWhatsapp } = require('./utils/whatsappService');

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api', uploadRoutes);
app.use('/api/vehicle-master', vehicleMasterRoutes);
app.use('/api/employee-master', employeeMasterRoutes);
app.use('/api/client-master', clientMasterRoutes);
app.use('/api/site-master', siteMasterRoutes);
app.use('/api/schedule-master', scheduleMasterRoutes);
app.use('/api/instrument-master', instrumentMasterRoutes);
app.use('/api/employee-auth', employeeAuthRoutes);
app.use('/api/employee-expense', employeeExpenseRoutes);

// Dynamically serve vehicle-master documents based on USE_NAS flag
const useNasFlag = process.env.USE_NAS;
const nasRoot = process.env.NAS_BASE_PATH || '/volume1/work';
const localRoot = process.env.LOCAL_BASE_PATH || './uploads';

let vehicleMasterUploadPath, employeeMasterUploadPath, clientMasterUploadPath, siteMasterUploadPath, instrumentMasterUploadPath;
if (useNasFlag === 'true') {
    vehicleMasterUploadPath = path.join(nasRoot, 'myapp', 'vehicle_master');
    employeeMasterUploadPath = path.join(nasRoot, 'myapp', 'employee_master');
    clientMasterUploadPath = path.join(nasRoot, 'myapp', 'client_master');
    siteMasterUploadPath = path.join(nasRoot, 'myapp', 'site_master');
    instrumentMasterUploadPath = path.join(nasRoot, 'myapp', 'instrument_master');
} else {
    vehicleMasterUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'vehicle_master')
        : path.join(process.cwd(), localRoot, 'vehicle_master');
    employeeMasterUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'employee_master')
        : path.join(process.cwd(), localRoot, 'employee_master');
    clientMasterUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'client_master')
        : path.join(process.cwd(), localRoot, 'client_master');
    siteMasterUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'site_master')
        : path.join(process.cwd(), localRoot, 'site_master');
    instrumentMasterUploadPath = path.isAbsolute(localRoot)
        ? path.join(localRoot, 'instrument_master')
        : path.join(process.cwd(), localRoot, 'instrument_master');
}

app.use('/uploads/vehicle_master', exprees.static(vehicleMasterUploadPath));
app.use('/uploads/employee_master', exprees.static(employeeMasterUploadPath));
app.use('/uploads/client_master', exprees.static(clientMasterUploadPath));
app.use('/uploads/site_master', exprees.static(siteMasterUploadPath));
app.use('/uploads/instrument_master', exprees.static(instrumentMasterUploadPath));

// Serve local infrastructure images from configured assets root
const ASSETS_ROOT = process.env.ASSETS_ROOT_PATH || 'D:/';
if (fs.existsSync(ASSETS_ROOT)) {
    app.use('/uploads/local', exprees.static(ASSETS_ROOT));
}

// Initialize WhatsApp client
initializeWhatsapp();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
