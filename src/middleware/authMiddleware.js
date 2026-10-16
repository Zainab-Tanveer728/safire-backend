// // const jwt  = require('jsonwebtoken');
// // const User = require('../models/User');

// // const protect = async (req, res, next) => {
// //   try {
// //     // Accept token from Authorization header OR query param
// //     // (query param needed for browser redirects like GitHub OAuth)
// //     const authHeader = req.headers.authorization;
// //     const token =
// //       (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
// //       || req.query.token
// //       || null;

// //     if (!token) {
// //       return res.status(401).json({ message: 'No token provided. Please log in.' });
// //     }

// //     const decoded = jwt.verify(token, process.env.JWT_SECRET);
// //     const user    = await User.findById(decoded.userId).select('-password');

// //     if (!user) {
// //       return res.status(401).json({ message: 'User no longer exists.' });
// //     }

// //     if (user.isSuspended) {
// //       return res.status(403).json({ message: 'Account suspended.' });
// //     }

// //     req.user = user; // available as req.user in all protected routes
// //     next();
// //   } catch (err) {
// //     return res.status(401).json({ message: 'Invalid or expired token.' });
// //   }
// // };

// // // Role guard — use after protect
// // // Usage: router.get('/admin', protect, restrictTo('admin'), handler)
// // const restrictTo = (...roles) => (req, res, next) => {
// //   if (!roles.includes(req.user.role)) {
// //     return res.status(403).json({ message: 'You do not have permission to do this.' });
// //   }
// //   next();
// // };

// // // module.exports = { protect, restrictTo };


// const jwt  = require('jsonwebtoken');
// const User = require('../models/User');

// const protect = async (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;
//     // B3: query-string token only allowed on the GitHub connect redirect
//     const allowQuery = req.originalUrl.split('?')[0].endsWith('/github/connect');

//     const token =
//       (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
//       || (allowQuery ? req.query.token : null)
//       || null;

//     if (!token) {
//       return res.status(401).json({ message: 'No token provided. Please log in.' });
//     }

//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     // B2: reset / github-state tokens can't be used as login tokens
//     if (decoded.purpose) {
//       return res.status(401).json({ message: 'Invalid token.' });
//     }

//     const user = await User.findById(decoded.userId).select('-password');
//     if (!user) {
//       return res.status(401).json({ message: 'User no longer exists.' });
//     }

//     // B4: check both the old flag and the new status field
//     if (user.isSuspended || user.status === 'suspended' || user.status === 'removed') {
//       return res.status(403).json({ message: 'Account suspended.' });
//     }

//     req.user = user;
//     next();
//   } catch (err) {
//     return res.status(401).json({ message: 'Invalid or expired token.' });
//   }
// };

// const restrictTo = (...roles) => (req, res, next) => {
//   if (!roles.includes(req.user.role)) {
//     return res.status(403).json({ message: 'You do not have permission to do this.' });
//   }
//   next();
// };

// module.exports = { protect, restrictTo };
  

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    // A token in the URL (?token=) is allowed ONLY for the GitHub connect redirect: browsers
    // cannot send a header on a redirect, and tokens in URLs end up in logs everywhere else.
    const allowQuery = req.originalUrl.split('?')[0].endsWith('/github/connect');

    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
      || (allowQuery ? req.query.token : null)
      || null;

    if (!token) {
      return res.status(401).json({ message: 'No token provided. Please log in.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reset-password and GitHub-state tokens carry a "purpose"; they must never work as a login.
    if (decoded.purpose) {
      return res.status(401).json({ message: 'Invalid token.' });
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }

    // The login route uses status; older code used isSuspended. Check both.
    if (user.isSuspended || user.status === 'suspended' || user.status === 'removed') {
      return res.status(403).json({ message: 'Account suspended.' });
    }

    req.user = user; // available as req.user in all protected routes
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Role guard - use after protect
// Usage: router.get('/admin', protect, restrictTo('admin'), handler)
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to do this.' });
  }
  next();
};

module.exports = { protect, restrictTo };