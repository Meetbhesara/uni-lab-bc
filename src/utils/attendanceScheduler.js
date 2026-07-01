const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const ScheduleMaster = require('../models/ScheduleMaster');
const { autoGenerateMonthSchedules } = require('./monthScheduleGenerator');

/**
 * Auto-marks active employees as Absent if they are NOT scheduled for the particular date,
 * provided that there is at least one schedule created for that date (indicating it is a working/scheduled day).
 * @param {Date} dateObj - The target date to check and update
 */
const autoMarkAbsentForDate = async (dateObj) => {
    try {
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        const day = dateObj.getDate();
        
        const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
        const endOfDay   = new Date(year, month, day, 23, 59, 59, 999);
        
        // 1. Fetch all schedules for this date
        const daySchedules = await ScheduleMaster.find({
            scheduleDate: { $gte: startOfDay, $lte: endOfDay }
        });
        
        // If there are no schedules at all for this date, it is either a non-working day
        // (holiday/Sunday) or the day/month has not been scheduled yet.
        // We skip auto-marking to avoid marking employees as absent when scheduling hasn't occurred.
        if (daySchedules.length === 0) {
            console.log(`[Attendance Scheduler] Bypassing auto-absent for ${year}-${month + 1}-${day}: No schedules defined for this day.`);
            return;
        }
        
        // 2. Extract IDs of all scheduled operatives and helpers on this date
        const scheduledEmployeeIds = new Set();
        daySchedules.forEach(s => {
            const opId = s.operative?._id || s.operative;
            if (opId) scheduledEmployeeIds.add(String(opId));
            
            (s.helpers || []).forEach(h => {
                const hId = h?._id || h;
                if (hId) scheduledEmployeeIds.add(String(hId));
            });
        });
        
        // 3. Fetch all Active employees (or legacy records without a status field)
        const activeEmployees = await EmployeeMaster.find({
            $or: [{ status: 'Active' }, { status: { $exists: false } }, { status: null }]
        });
        
        let count = 0;
        for (const emp of activeEmployees) {
            const empIdStr = String(emp._id);
            
            // Bypass employees who ARE scheduled on this date
            if (scheduledEmployeeIds.has(empIdStr)) {
                continue;
            }
            
            // Check if there is an existing expense/attendance record for this date
            const existing = await EmployeeExpense.findOne({
                employeeId: emp._id,
                date: { $gte: startOfDay, $lte: endOfDay }
            });
            
            // If no record exists, or if a record exists but attendance is not Present and not Absent
            if (!existing || (existing.attendance !== 'Present' && existing.attendance !== 'Absent')) {
                await EmployeeExpense.findOneAndUpdate(
                    {
                        employeeId: emp._id,
                        date: { $gte: startOfDay, $lte: endOfDay }
                    },
                    {
                        $set: {
                            attendance: 'Absent',
                            attendanceRemark: (existing?.attendanceRemark && !existing.attendanceRemark.toLowerCase().includes('auto-marked')) ? existing.attendanceRemark : ''
                        },
                        $setOnInsert: {
                            employeeId: emp._id,
                            date: startOfDay,
                            expenses: { breakfast: 0, lunch: 0, dinner: 0, petrol: 0 },
                            otherExpensesList: [],
                            totalExpense: 0,
                            clientSites: []
                        }
                    },
                    { upsert: true }
                );
                count++;
            }
        }
        console.log(`[Attendance Scheduler] Auto-marked ${count} unscheduled employee(s) as Absent for date: ${year}-${month + 1}-${day}`);
    } catch (error) {
        console.error(`[Attendance Scheduler] Error for date ${dateObj.toLocaleDateString()}:`, error);
    }
};

/**
 * Schedules the next auto-absent run for 11:59:59 PM today.
 */
const scheduleNextRun = () => {
    const now = new Date();
    
    // Set target time to 11:59:59 PM today
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    let delay = target.getTime() - now.getTime();
    if (delay < 0) {
        // If past 11:59:59 PM today, schedule for 11:59:59 PM tomorrow
        target.setDate(target.getDate() + 1);
        delay = target.getTime() - now.getTime();
    }
    
    console.log(`[Attendance Scheduler] Next auto-absent run scheduled in ${(delay / 1000 / 60).toFixed(2)} minutes (at ${target.toLocaleString()})`);
    
    setTimeout(async () => {
        const today = new Date();
        await autoMarkAbsentForDate(today);
        // Schedule next run recursively
        scheduleNextRun();
    }, delay);
};

/**
 * Initial run on server startup to catch up on unmarked attendance for the past 7 days
 * (handling server downtime) and start the scheduler loop.
 */
const initializeScheduler = async () => {
    console.log('[Attendance Scheduler] Initializing...');
    
    // Generate any missing MONTH schedules first (important for correct downtime check)
    await autoGenerateMonthSchedules();
    
    // Catch up attendance for the past 7 days (downtime protection)
    for (let i = 7; i >= 1; i--) {
        const catchUpDate = new Date();
        catchUpDate.setDate(catchUpDate.getDate() - i);
        await autoMarkAbsentForDate(catchUpDate);
    }
    
    // Also, if the server is started late (e.g. exactly between 11:59:00 PM and 11:59:59 PM)
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() >= 59) {
        await autoMarkAbsentForDate(now);
    }
    
    // Start scheduling loop
    scheduleNextRun();
};

module.exports = {
    initializeScheduler
};
