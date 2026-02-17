const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    // Get token from header
    const tokenHeader = req.header('x-auth-token') || req.header('Authorization');

    // Check if not token
    if (!tokenHeader) {
        return next(); // Proceed without user
    }

    let token = tokenHeader;
    if (tokenHeader.startsWith('Bearer ')) {
        token = tokenHeader.slice(7, tokenHeader.length).trimLeft();
    }

    // Verify token
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id: ..., isAdmin: ... }
        next();
    } catch (err) {
        // Invalid token - treat as guest
        next();
    }
};
