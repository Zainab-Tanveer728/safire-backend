// src/routes/disputeRoutes.js   (mounted at /api/disputes)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadProject } = require('../middleware/projectAccess');
const { loadDispute } = require('../middleware/changeRequestAccess');
const c = require('../controllers/disputeController');

router.use(protect);

router.get ('/project/:projectId', loadProject('projectId'),                  c.listForProject);
router.post('/project/:projectId', loadProject('projectId', { write: true }), c.raise);

router.get ('/:id',         loadDispute('id'), c.getOne);
router.post('/:id/resolve', loadDispute('id'), c.resolve);      // admin check is inside (admins are read-only elsewhere)

module.exports = router;