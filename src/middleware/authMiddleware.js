const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    // Accept token from Authorization header OR query param
    // (query param needed for browser redirects like GitHub OAuth)
    const authHeader = req.headers.authorization;
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
      || req.query.token
      || null;

    if (!token) {
      return res.status(401).json({ message: 'No token provided. Please log in.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ message: 'Account suspended.' });
    }

    req.user = user; // available as req.user in all protected routes
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Role guard — use after protect
// Usage: router.get('/admin', protect, restrictTo('admin'), handler)
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to do this.' });
  }
  next();
};

module.exports = { protect, restrictTo };