const ScheduleMaster = require('../models/ScheduleMaster');

/**
 * Auto-generates missing daily schedules for active MONTH contracts.
 * It fills in any gaps (including today) between the last generated schedule date and the current date,
 * up to the contract's endDate.
 */
const autoGenerateMonthSchedules = async () => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const cronCutoffDate = new Date('2026-06-01T00:00:00.000Z');

        // Find all MONTH schedules that are active (not Paused or Rejected) and were scheduled in the past
        const activeMonthSchedules = await ScheduleMaster.find({
            scheduleType: 'MONTH',
            dayStatus: { $nin: ['Paused', 'Rejected'] },
            scheduleDate: { $gte: cronCutoffDate, $lt: todayStart }
        }).sort({ scheduleDate: -1 });

        const processedGroups = new Set();
        
        for (const doc of activeMonthSchedules) {
            if (!doc.monthGroupId || processedGroups.has(doc.monthGroupId)) continue;
            processedGroups.add(doc.monthGroupId); // Only process the latest schedule for each group

            if (!doc.endDate) continue;
            const endDateObj = new Date(doc.endDate);
            endDateObj.setHours(0, 0, 0, 0);

            // The last generated schedule date
            const lastDate = new Date(doc.scheduleDate);
            lastDate.setHours(0, 0, 0, 0);

            // Generate schedules for each day from (lastDate + 1) up to todayStart
            let currentDate = new Date(lastDate);
            currentDate.setDate(currentDate.getDate() + 1);

            while (currentDate <= todayStart && currentDate <= endDateObj) {
                const targetDate = new Date(currentDate);
                
                // Check if a schedule already exists for this group on this targetDate
                const exists = await ScheduleMaster.findOne({
                    monthGroupId: doc.monthGroupId,
                    scheduleDate: {
                        $gte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0),
                        $lte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999)
                    }
                });

                if (!exists) {
                    const newSchedule = new ScheduleMaster({
                        client: doc.client,
                        site: doc.site,
                        scheduleDate: targetDate,
                        endDate: doc.endDate,
                        workForAppley: doc.workForAppley,
                        operative: doc.operative,
                        helpers: doc.helpers,
                        ledger: doc.ledger,
                        amount: doc.amount,
                        notes: doc.notes,
                        vehicle: doc.vehicle,
                        instruments: doc.instruments,
                        status: doc.status ? (doc.status.toLowerCase() === 'active' ? 'Active' : (doc.status.toLowerCase() === 'deactive' ? 'Deactive' : doc.status)) : 'Active',
                        dayStatus: 'Scheduled',
                        scheduleType: 'MONTH',
                        monthGroupId: doc.monthGroupId
                    });
                    await newSchedule.save();
                    console.log(`[Month Schedule Generator] Generated schedule for group ${doc.monthGroupId} on date: ${targetDate.toLocaleDateString()}`);
                }

                // Increment currentDate by 1 day
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
    } catch (error) {
        console.error('[Month Schedule Generator] Error generating month schedules:', error);
    }
};

module.exports = {
    autoGenerateMonthSchedules
};
