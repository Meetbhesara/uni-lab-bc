const jwt = require('jsonwebtoken');

const employeeAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, msg: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'employee') return res.status(403).json({ success: false, msg: 'Not an employee token' });
        req.employeeId = decoded.employeeId;
        req.employee = { id: decoded.employeeId };
        next();
    } catch {
        res.status(401).json({ success: false, msg: 'Invalid or expired token' });
    }
};

module.exports = { employeeAuth };
