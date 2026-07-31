/**
 * followUpCron.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily cron job — runs every morning at 9:00 AM
 * Finds all active quotations (status != Done/Reject) where nextFollowUp = TODAY
 * Sends a personalized WhatsApp reminder to each user who has enquiry read permission
 * Uses a 5–8 second random delay between each message to prevent WhatsApp ban.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const cron = require('node-cron');
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { sendWhatsapp } = require('../utils/whatsappService');

// Random delay helper: waits between minMs and maxMs milliseconds
const randomDelay = (minMs = 5000, maxMs = 8000) => {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, ms));
};

// Format a date as DD/MM/YYYY
const fmtDate = (d) => {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-GB');
};

const sendFollowUpReminders = async () => {
    try {
        console.log('[FollowUpCron] 🕘 Running daily follow-up check...');

        // Build today's date range (midnight to midnight)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        // Find all open quotations where nextFollowUp falls today AND is the latest revision
        const dueQuotations = await Quotation.find({
            status: { $nin: ['Done', 'Reject'] },
            isLatest: true,  // ← Never alert for old/superseded revisions
            nextFollowUp: { $gte: todayStart, $lte: todayEnd }
        }).populate('enquiry');

        // Find all open whatsapp enquiries where nextFollowUp falls today
        const Enquiry = require('../models/Enquiry');
        const dueEnquiries = await Enquiry.find({
            type: 'whatsapp',
            status: { $nin: ['Done', 'Reject'] },
            nextFollowUp: { $gte: todayStart, $lte: todayEnd }
        });

        if (dueQuotations.length === 0 && dueEnquiries.length === 0) {
            console.log('[FollowUpCron] ✅ No follow-ups due today.');
            return;
        }

        console.log(`[FollowUpCron] 📋 Found ${dueQuotations.length} quotation(s) and ${dueEnquiries.length} WhatsApp log(s) due for follow-up today.`);

        // Find all users who have enquiry read permission (or are superAdmin / admin)
        const allUsers = await User.find({});
        const targetUsers = allUsers.filter(u => {
            if (u.isSuperAdmin || u.isAdmin) return true;
            const perms = u.permissions || {};
            // Check enquiry read permission (check common key names)
            return (
                perms?.enquiry?.read === true ||
                perms?.enquiries?.read === true ||
                perms?.outgoingEnquiry?.read === true ||
                perms?.enquiryTab?.read === true ||
                perms?.outgoingEnquiries?.read === true
            );
        }).filter(u => u.phone); // Only include users with a phone number

        if (targetUsers.length === 0) {
            console.log('[FollowUpCron] ⚠️ No users with enquiry permission and phone found. Skipping.');
            return;
        }

        console.log(`[FollowUpCron] 👥 Will notify ${targetUsers.length} user(s).`);

        const allDueItems = [
            ...dueQuotations.map(q => ({ type: 'Quotation', data: q })),
            ...dueEnquiries.map(e => ({ type: 'WhatsApp Log', data: e }))
        ];

        // For each due item, send WhatsApp to each target user
        for (const item of allDueItems) {
            const isQuote = item.type === 'Quotation';
            const doc = item.data;

            const clientName = isQuote 
                ? (doc.enquiry?.companyName || doc.enquiry?.Name || 'Unknown Client')
                : (doc.companyName || doc.Name || 'Unknown Client');

            const refNo = isQuote ? (doc.refNo || 'N/A') : `N/A`;
            const grandTotal = isQuote ? (doc.grandTotal ? `₹${Number(doc.grandTotal).toLocaleString('en-IN')}` : 'N/A') : 'N/A';
            const lastFollowUp = doc.followUps?.length > 0
                ? doc.followUps[doc.followUps.length - 1]
                : null;
            const lastRemark = lastFollowUp ? lastFollowUp.remark : '(No previous remark — first follow-up)';
            const followUpCount = doc.followUps?.length || 0;

            console.log(`[FollowUpCron] 📨 Sending reminders for ${item.type} (${clientName})`);

            for (const user of targetUsers) {
                const userName = user.name || user.contactPersonName || 'Team';

                let message = `📋 *FOLLOW-UP REMINDER*\n` +
                              `Hi *${userName}*, you have a ${item.type} follow-up due today!\n\n` +
                              `🏢 *Client:* ${clientName}\n`;
                
                if (isQuote) {
                    message += `📄 *Ref No:* ${refNo}\n` +
                               `💰 *Quote Value:* ${grandTotal}\n`;
                }

                message += `📊 *Status:* ${doc.status}\n` +
                           `🔁 *Follow-ups Done:* ${followUpCount}\n` +
                           `💬 *Last Remark:* ${lastRemark}\n\n` +
                           `📅 *Today's Date:* ${fmtDate(new Date())}\n\n`;

                if (isQuote) {
                    message += `Please open the app → Enquiries → Outbound Quotations to add your follow-up remark.`;
                } else {
                    message += `Please open the app → Enquiries → WhatsApp Logs to add your follow-up remark.`;
                }

                try {
                    await sendWhatsapp(user.phone, message);
                    console.log(`[FollowUpCron] ✅ Sent to ${userName} (${user.phone})`);
                } catch (err) {
                    console.error(`[FollowUpCron] ❌ Failed to send to ${userName} (${user.phone}): ${err.message}`);
                }

                // ─── ANTI-BAN DELAY: 5–8 seconds between each message ───
                await randomDelay(5000, 8000);
            }

            console.log(`[FollowUpCron] ✔️ Done notifying for ${item.type} (${clientName})`);
        }

        console.log('[FollowUpCron] 🎉 All follow-up reminders sent.');
    } catch (err) {
        console.error('[FollowUpCron] ❌ Error in follow-up cron:', err.message);
    }
};

/**
 * Starts the daily 9:00 AM follow-up cron job.
 * Call this once during server startup.
 */
const startFollowUpCron = () => {
    // Runs every day at 9:00 AM (cron: minute=0, hour=9)
    cron.schedule('0 9 * * *', () => {
        console.log('[FollowUpCron] ⏰ Cron triggered at 9:00 AM');
        sendFollowUpReminders();
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('[FollowUpCron] 🟢 Follow-up cron scheduled — daily at 9:00 AM IST');
};

module.exports = { startFollowUpCron, sendFollowUpReminders };
