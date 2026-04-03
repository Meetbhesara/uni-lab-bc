const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    // Get token from header
    const tokenHeader = req.header('x-auth-token') || req.header('Authorization');

    // Check if not token
    if (!tokenHeader) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    let token = tokenHeader;
    if (tokenHeader.startsWith('Bearer ')) {
        token = tokenHeader.slice(7, tokenHeader.length).trimLeft();
    }

    // Verify token
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // --- Daily Session Reset (Logout at 12:00 AM) ---
        // Get today's midnight timestamp in seconds (IST/Server Time)
        const todayMidnight = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
        
        // If it's 2026-04-03, iat MUST be >= 2026-04-03 00:00:00
        if (decoded.iat && decoded.iat < todayMidnight) {
            return res.status(401).json({ msg: 'Daily session expired. Please login again.' });
        }

        req.user = decoded; // { id: ..., isAdmin: ... }
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};
