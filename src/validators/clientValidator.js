// validators/clientValidators.js
const { body } = require("express-validator");

// ─── M11: Register Client ────────────────────────────────────────────────────
exports.registerClientValidator = [
  body("fullName")
    .trim()
    .notEmpty().withMessage("Full name is required.")
    .isLength({ min: 2 }).withMessage("Full name must be at least 2 characters.")
    .matches(/^[a-zA-Z\s]+$/).withMessage("Full name may only contain letters and spaces."),

  body("email")
    .trim()
    .toLowerCase()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address."),

  body("password")
    .notEmpty().withMessage("Password is required.")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters.")
    .matches(/(?=.*[a-zA-Z])(?=.*[0-9])/).withMessage("Password must contain letters and numbers."),

  body("country")
    .notEmpty().withMessage("Country is required."),
];

// ─── M12: Company Setup ──────────────────────────────────────────────────────
exports.companySetupValidator = [
  body("companyName")
    .trim()
    .notEmpty().withMessage("Company name is required.")
    .isLength({ min: 2 }).withMessage("Company name must be at least 2 characters."),

  body("website")
    .optional({ checkFalsy: true })
    .isURL({ protocols: ["https"], require_protocol: true })
    .withMessage("Website must be a valid HTTPS URL."),

  body("industry")
    .notEmpty().withMessage("Please select an industry."),

  body("country")
    .notEmpty().withMessage("Country is required."),

  body("about")
    .optional()
    .isLength({ max: 400 }).withMessage("About section must be under 400 characters."),
];