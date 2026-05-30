const mongoose = require('mongoose');

const DraftingWorkSchema = new mongoose.Schema({
    documentName: { type: String, required: true },
    documentType: { type: String }, // dwg, pdf, doc, img, etc.
    documentUrl: { type: String, required: true },
    documentPath: { type: String },
    
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientMaster' },
    site: { type: mongoose.Schema.Types.ObjectId, ref: 'SiteMaster' },
    
    status: {
        type: String,
        enum: ['Received', 'Under Review', 'Drafting In Progress', 'Correction Pending', 'Approved', 'Completed'],
        default: 'Received'
    },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    
    uploadedBy: { type: String }, // Name or ref
    receivedDate: { type: Date, default: Date.now },

    // Tracking
    progress: { type: Number, default: 0 },
    assignedTo: { type: String }, // Employee Name or ref
    deadline: { type: Date },
    trackingNotes: { type: String },

    // Final
    version: { type: String, default: 'v1.0' },
    approvedBy: { type: String },
    approvalDate: { type: Date },
    
    isFinal: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('DraftingWork', DraftingWorkSchema);
