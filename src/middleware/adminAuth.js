// src/middleware/adminAuth.js
// Use this on all /api/admin/* routes.
const jwt = require("jsonwebtoken");

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose) return res.status(401).json({ message: "Invalid token." });
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }
    // The token holds userId, but admin code reads req.user._id: provide both.
    req.user = { ...decoded, _id: decoded.userId };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};