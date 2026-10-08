const cron = require('node-cron');
const AdminLoginLog = require('../models/AdminLoginLog');

/**
 * startMidnightLogoutCron
 * Automatically closes any active admin login sessions at 11:59:50 PM IST every night,
 * ensuring no session crosses the midnight day boundary.
 */
const startMidnightLogoutCron = () => {
    cron.schedule('50 59 23 * * *', async () => {
        try {
            const now = new Date();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istDate = new Date(now.getTime() + istOffset);
            const dateStr = istDate.toISOString().split('T')[0];

            const unclosedLogs = await AdminLoginLog.find({
                dateStr,
                logoutAt: { $exists: false }
            });

            for (const log of unclosedLogs) {
                log.logoutAt = now;
                await log.save();
            }

            if (unclosedLogs.length > 0) {
                console.log(`[MidnightLogoutCron] 🌙 Auto-closed ${unclosedLogs.length} active session(s) at midnight for ${dateStr}`);
            }
        } catch (err) {
            console.error('[MidnightLogoutCron] Error auto-closing midnight sessions:', err.message);
        }
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('[MidnightLogoutCron] 🟢 Midnight session auto-logout cron scheduled — daily at 11:59:50 PM IST');
};

module.exports = { startMidnightLogoutCron };
