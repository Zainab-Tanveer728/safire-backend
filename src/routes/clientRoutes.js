// routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validate");
const { companySetupValidator } = require("../validators/clientValidator");
const multerUpload = require("../config/multer");

// ── Public routes (no auth required) ─────────────────────────────────────────

// POST /api/auth/register/client  — M11
// NOTE: This is registered on authRoutes.js to match /api/auth/register/client
// but the controller lives here for organization. See authRoutes.js comment below.

// ── Protected routes (JWT required) ──────────────────────────────────────────
router.use(protect);

// POST /api/client/profile/company-setup   — M12
router.post(
  "/profile/company-setup",
  multerUpload.single("logo"),          // logo field from FormData
  companySetupValidator,
  validateRequest,
  clientController.setupCompanyProfile
);

// GET /api/client/profile/onboarding-status  — M13
router.get(
  "/profile/onboarding-status",
  clientController.getOnboardingStatus
);

// GET /api/client/profile
router.get(
  "/profile",
  clientController.getClientProfile
);

// PATCH /api/client/profile
router.patch(
  "/profile",
  clientController.updateClientProfile
);

module.exports = router;

/*
 * ─── How to wire this into app.js ───────────────────────────────────────────
 *
 * In src/app.js, add:
 *   const clientRoutes = require("./routes/clientRoutes");
 *   app.use("/api/client", clientRoutes);
 *
 * In src/routes/authRoutes.js, add the register endpoint:
 *   const { registerClient } = require("../controllers/clientController");
 *   router.post("/register/client", registerClientValidator, validateRequest, registerClient);
 */