// src/routes/requirementRoutes.js   (mounted at /api/requirements)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadProject, loadMeeting, loadRequirement } = require('../middleware/projectAccess');
const c = require('../controllers/requirementController');

router.use(protect);

// By project
router.get ('/project/:projectId',      loadProject('projectId'),                  c.listForProject);
router.post('/project/:projectId',      loadProject('projectId', { write: true }), c.addManual);
router.post('/project/:projectId/bulk', loadProject('projectId', { write: true }), c.bulk);

// By meeting (summary / notes / user stories)
router.get('/meeting/:meetingId/document', loadMeeting('meetingId'),                  c.getDocument);
router.put('/meeting/:meetingId/document', loadMeeting('meetingId', { write: true }), c.saveDocument);

// One requirement  (keep these LAST so "/project/..." is never mistaken for an id)
router.get  ('/:id',         loadRequirement('id'),                  c.getOne);
router.patch('/:id',         loadRequirement('id', { write: true }), c.edit);
router.post ('/:id/confirm', loadRequirement('id', { write: true }), c.confirm);
router.post ('/:id/reject',  loadRequirement('id', { write: true }), c.reject);
router.post ('/:id/revert',  loadRequirement('id', { write: true }), c.revert);

module.exports = router;