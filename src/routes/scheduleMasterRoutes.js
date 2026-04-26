const express = require('express');
const router = express.Router();
const { createSchedule, updateSchedule, getSchedules, getSitesByClient } = require('../controllers/scheduleMasterController');

// GET  /api/schedule-master?date=2024-01-15  (date-wise)
// GET  /api/schedule-master?startDate=2024-01-01&endDate=2024-01-31  (range)
// GET  /api/schedule-master?client=<id>&site=<id>  (filtered)
router.get('/', getSchedules);

// Helper: get sites for a specific client (used in frontend dropdown cascade)
router.get('/sites-by-client/:clientId', getSitesByClient);

// POST /api/schedule-master  (create)
router.post('/', createSchedule);

// PUT  /api/schedule-master/:id  (partial update)
router.put('/:id', updateSchedule);

module.exports = router;
