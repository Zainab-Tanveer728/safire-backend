// src/routes/freelancerDirectoryRoutes.js   (mounted at /api/freelancers)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/jobController');

router.get('/',    protect, c.directory);
router.get('/:id', protect, c.freelancerProfile);
module.exports = router;