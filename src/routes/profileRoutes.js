// ================================================================
//  src/routes/profile.js
//  Handles freelancer basic profile setup (M5)
//  PUT /api/profile/basic
// ================================================================

const express   = require("express");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const jwt       = require("jsonwebtoken");
const User      = require("../models/User");
const router    = express.Router();

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided." });
  }
  try {
    const token   = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId    = decoded.userId;
    req.userRole  = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

// ── Multer config — avatar uploads ───────────────────────────────
const uploadsDir = path.join(__dirname, "../../uploads/avatars");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.userId}_${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // FR5.1 — Only JPG and PNG
  if (["image/jpeg", "image/png"].includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG and PNG images are accepted."), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // FR5.1 — max 2 MB
});

// ════════════════════════════════════════════════════════════════
//  PUT /api/profile/basic
//  Saves basic profile info for M5
// ════════════════════════════════════════════════════════════════
router.put(
  "/basic",
  requireAuth,
  (req, res, next) => {
    // Wrap multer so we can return proper JSON errors
    upload.single("avatar")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ message: "Image must be under 2 MB." });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { name, headline, location, bio } = req.body;

      // FR5.6 — Full name is the only mandatory field
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Full name is required." });
      }

      // FR5.3 — Headline max 100 chars
      if (headline && headline.trim().length > 100) {
        return res.status(400).json({ message: "Headline must not exceed 100 characters." });
      }

      // FR5.5 — Bio max 500 chars
      if (bio && bio.trim().length > 500) {
        return res.status(400).json({ message: "Bio must not exceed 500 characters." });
      }

      const updateData = {
        name:     name.trim(),
        headline: headline?.trim() || "",
        location: location?.trim() || "",
        bio:      bio?.trim() || "",
        "onboarding.basicProfileDone": true,
      };

      // If avatar was uploaded, save its URL path
      if (req.file) {
        updateData.avatarUrl = `/uploads/avatars/${req.file.filename}`;
      }

      const user = await User.findByIdAndUpdate(
        req.userId,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select("-password -otp -otpExpiry");

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      res.json({
        message: "Profile saved successfully.",
        user: {
          name:      user.name,
          headline:  user.headline,
          location:  user.location,
          bio:       user.bio,
          avatarUrl: user.avatarUrl,
          onboarding: user.onboarding,
        },
      });

    } catch (err) {
      console.error("Profile save error:", err.message);
      res.status(500).json({ message: "Server error." });
    }
  }
);

// ════════════════════════════════════════════════════════════════
//  GET /api/profile/me
//  Returns current user's profile data
// ════════════════════════════════════════════════════════════════
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select(
      "name headline location bio avatarUrl role onboarding trustScore"
    );
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

module.exports = router;