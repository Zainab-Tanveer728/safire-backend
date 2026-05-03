const express            = require('express');
const router             = express.Router();
const { protect }        = require('../middleware/authMiddleware');
const { processProfile } = require('../controllers/aiController');

router.post('/process', protect, processProfile);

module.exports = router;