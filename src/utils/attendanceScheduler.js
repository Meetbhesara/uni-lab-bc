const EmployeeExpense = require('../models/EmployeeExpense');
const EmployeeMaster = require('../models/EmployeeMaster');
const ScheduleMaster = require('../models/ScheduleMaster');
const { autoGenerateMonthSchedules } = require('./monthScheduleGenerator');

/**
 * Converts any Date object to IST date components (year, month, day, hour, minute, second).
 * IST is UTC + 5:30 (19800000 ms).
 */
const getISTComponents = (dateObj = new Date()) => {
    const istDate = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
    return {
        year: istDate.getUTCFullYear(),
        month: istDate.getUTCMonth(),
        day: istDate.getUTCDate(),
        hour: istDate.getUTCHours(),
        minute: istDate.getUTCMinutes(),
        second: istDate.getUTCSeconds()
    };
};

/**
 * Auto-marks active employees as Absent if they are NOT scheduled for the particular date,
 * provided that there is at least one schedule created for that date (indicating it is a working/scheduled day).
 * @param {Date} dateObj - The target date to check and update
 */
const autoMarkAbsentForDate = async (dateObj) => {
    try {
        const { year, month, day } = getISTComponents(dateObj);
        
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
        
        const User = require('../models/User');
        const adminUsers = await User.find({ isAdmin: true }).select('email').lean();
        const adminEmailSet = new Set(
            adminUsers
                .map(u => (u.email && typeof u.email === 'string') ? u.email.toLowerCase().trim() : '')
                .filter(Boolean)
        );

        let count = 0;
        for (const emp of activeEmployees) {
            const empIdStr = String(emp._id);
            
            // Bypass employees who ARE scheduled on this date
            if (scheduledEmployeeIds.has(empIdStr)) {
                continue;
            }

            // Bypass employees whose email is linked to an Admin user account
            const empEmail = (emp.email && typeof emp.email === 'string') ? emp.email.toLowerCase().trim() : '';
            if (empEmail && adminEmailSet.has(empEmail)) {
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
        console.error(`[Attendance Scheduler] Error for date:`, error);
    }
};

/**
 * Schedules the next auto-absent run for 11:00:00 PM (23:00:00) IST today.
 */
const scheduleNextRun = () => {
    const now = new Date();
    const { year, month, day } = getISTComponents(now);
    
    // In IST (UTC+05:30), 23:00:00 IST corresponds exactly to 17:30:00 UTC
    let targetUTC = new Date(Date.UTC(year, month, day, 17, 30, 0, 0));
    
    // If current time is already at or past 11:00:00 PM IST today, schedule for 11:00:00 PM IST tomorrow
    if (now.getTime() >= targetUTC.getTime()) {
        targetUTC = new Date(Date.UTC(year, month, day + 1, 17, 30, 0, 0));
    }
    
    const delay = targetUTC.getTime() - now.getTime();
    
    const { year: tY, month: tM, day: tD, hour: tH, minute: tMin } = getISTComponents(targetUTC);
    console.log(`[Attendance Scheduler] Next auto-absent run scheduled in ${(delay / 1000 / 60).toFixed(2)} minutes (at ${tY}-${String(tM + 1).padStart(2, '0')}-${String(tD).padStart(2, '0')} ${String(tH).padStart(2, '0')}:${String(tMin).padStart(2, '0')} IST)`);
    
    setTimeout(async () => {
        const runDate = new Date();
        await autoMarkAbsentForDate(runDate);
        // Schedule next run recursively
        scheduleNextRun();
    }, delay);
};

/**
 * Initial run on server startup to catch up on unmarked attendance for the past 7 days
 * (handling server downtime) and start the scheduler loop.
 */
const initializeScheduler = async () => {
    console.log('[Attendance Scheduler] Initializing with strict IST timing (11:00 PM IST)...');
    
    // Generate any missing MONTH schedules first (important for correct downtime check)
    await autoGenerateMonthSchedules();
    
    // Catch up attendance for the past 7 days (downtime protection)
    for (let i = 7; i >= 1; i--) {
        const catchUpDate = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
        await autoMarkAbsentForDate(catchUpDate);
    }
    
    // Also, if the server is started late (between 11:00 PM and midnight IST today)
    const now = new Date();
    const { hour } = getISTComponents(now);
    if (hour >= 23) {
        await autoMarkAbsentForDate(now);
    }
    
    // Start scheduling loop
    scheduleNextRun();
};

module.exports = {
    initializeScheduler
};
