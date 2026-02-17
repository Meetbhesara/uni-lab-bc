const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        res.status(403).json({ success: false, msg: 'Access denied: Admins only' });
    }
};

module.exports = verifyAdmin;
