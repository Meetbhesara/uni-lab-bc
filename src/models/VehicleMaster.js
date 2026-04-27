const mongoose = require('mongoose');

const VehicleMasterSchema = new mongoose.Schema({
    vehicleNumber: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        required: true
    },
    vehicleName: {
        type: String,
        trim: true
    },
    insuranceDate: {
        type: Date
    },
    pucDate: {
        type: Date
    },
    serviceDate: {
        type: Date
    },
    rcBook: {
        name: String,
        url: String,
        path: String
    },
    insurancePhoto: {
        name: String,
        url: String,
        path: String
    },
    pucPhoto: {
        name: String,
        url: String,
        path: String
    },
    logInName: {
        type: String
    },
    vehiclePhotos: [{
        name: String,
        url: String,
        path: String
    }],
    documents: [{
        name: String,
        url: String,
        type: String,
        path: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('VehicleMaster', VehicleMasterSchema);
