// src/routes/projectRoutes.js   (mounted at /api/projects)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/projectController');

// Role check lives here, so this file only depends on `protect` from your authMiddleware.
const onlyClient = (req, res, next) =>
  req.user && req.user.role === 'client'
    ? next()
    : res.status(403).json({ message: 'Only clients can create projects.' });

router.use(protect);
router.post('/',   onlyClient, c.createProject);
router.get('/',    c.listMyProjects);
router.get('/:id', c.getProject);

module.exports = router;