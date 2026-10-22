const { validationResult } = require("express-validator");

function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: result.array()[0].msg,
      errors: result.array(),
    });
  }

  return next();
}

module.exports = { validateRequest };