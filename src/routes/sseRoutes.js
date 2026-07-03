const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const { addClient } = require('../utils/sseManager');

/**
 * GET /api/events
 * Admin browsers connect here to receive real-time push events.
 * The connection stays open until the browser tab closes.
 */
router.get('/', auth, (req, res) => {
    addClient(req, res);
});

module.exports = router;
