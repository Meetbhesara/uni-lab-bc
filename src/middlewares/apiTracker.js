// API Performance & Speed Tracker Middleware
const statsBuffer = [];
const MAX_BUFFER_SIZE = 100;
const routeStats = {};

const apiTracker = (req, res, next) => {
    // Exclude static assets or health check self-ping from metrics
    if (req.path.startsWith('/uploads') || req.path === '/api/admin/health') {
        return next();
    }

    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const method = req.method;
        // Normalize route path to strip dynamic IDs like Mongo ObjectIds
        const normalizedPath = req.baseUrl + (req.route ? req.route.path : req.path.replace(/\/[a-f0-9]{24}/gi, '/:id'));
        const routeKey = `${method} ${normalizedPath}`;

        // Update route-level aggregate statistics
        if (!routeStats[routeKey]) {
            routeStats[routeKey] = {
                method,
                path: normalizedPath,
                count: 0,
                totalDuration: 0,
                minMs: duration,
                maxMs: duration,
                lastStatus: res.statusCode
            };
        }

        const stat = routeStats[routeKey];
        stat.count += 1;
        stat.totalDuration += duration;
        stat.minMs = Math.min(stat.minMs, duration);
        stat.maxMs = Math.max(stat.maxMs, duration);
        stat.lastStatus = res.statusCode;

        // Push to rolling history buffer
        statsBuffer.push({
            route: routeKey,
            method,
            path: normalizedPath,
            duration,
            status: res.statusCode,
            timestamp: new Date()
        });

        if (statsBuffer.length > MAX_BUFFER_SIZE) {
            statsBuffer.shift();
        }
    });

    next();
};

const getApiStats = () => {
    const routeList = Object.keys(routeStats).map(key => {
        const s = routeStats[key];
        const avgMs = Math.round(s.totalDuration / s.count);
        let speed = 'FAST'; // 🟢 < 100ms
        if (avgMs >= 100 && avgMs <= 400) speed = 'MODERATE'; // 🟡 100ms - 400ms
        if (avgMs > 400) speed = 'SLOW'; // 🔴 > 400ms

        return {
            key,
            method: s.method,
            path: s.path,
            count: s.count,
            avgMs,
            minMs: s.minMs,
            maxMs: s.maxMs,
            speed,
            lastStatus: s.lastStatus
        };
    });

    // Sort by average duration descending (slowest APIs at top)
    routeList.sort((a, b) => b.avgMs - a.avgMs);

    return {
        totalTrackedRoutes: routeList.length,
        slowRoutes: routeList.filter(r => r.speed === 'SLOW'),
        routes: routeList,
        recentLogs: statsBuffer.slice(-20).reverse()
    };
};

module.exports = { apiTracker, getApiStats };
