const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // e.g. "quotation_2026"
    seq: { type: Number, default: 0 }
});

module.exports = mongoose.model('Counter', CounterSchema);
