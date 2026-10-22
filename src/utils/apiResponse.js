function apiResponse(res, statusCode, message, data = {}) {
  return res.status(statusCode).json({
    success: statusCode < 400,
    message,
    data,
  });
}

module.exports = { apiResponse };