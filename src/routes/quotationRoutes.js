const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const { sendFollowUpReminders } = require('../cron/followUpCron');

router.post('/', quotationController.createQuotation);
router.get('/', quotationController.getQuotations);
router.get('/test-followup-cron', async (req, res) => {
    try {
        await sendFollowUpReminders();
        res.json({ msg: 'Follow-up check executed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.put('/:id', quotationController.updateQuotation);
router.delete('/:id', quotationController.deleteQuotation);
router.post('/:id/follow-up', quotationController.addFollowUp);

module.exports = router;

