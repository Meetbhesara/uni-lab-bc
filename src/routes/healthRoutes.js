const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const { getSystemMetrics, generateAiDiagnostics } = require('../utils/healthMonitor');

// GET /api/admin/health - Fetch complete live server, DB, WhatsApp, and API performance health
router.get('/', auth, async (req, res) => {
    try {
        const metrics = await getSystemMetrics();
        const aiDiagnostics = await generateAiDiagnostics(metrics);

        res.json({
            success: true,
            metrics,
            aiDiagnostics
        });
    } catch (error) {
        console.error('Health Check Failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
