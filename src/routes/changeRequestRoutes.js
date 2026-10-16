// src/routes/changeRequestRoutes.js   (mounted at /api/change-requests)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadProject } = require('../middleware/projectAccess');
const { loadChangeRequest } = require('../middleware/changeRequestAccess');
const c = require('../controllers/changeRequestController');

router.use(protect);

router.get('/summary', c.summary);                                                       // dashboard numbers

// By project
router.get ('/project/:projectId',           loadProject('projectId'),                  c.list);
router.post('/project/:projectId',           loadProject('projectId', { write: true }), c.create);
router.get ('/project/:projectId/history',   loadProject('projectId'),                  c.history);
router.post('/project/:projectId/baseline',  loadProject('projectId', { write: true }), c.setBaseline);

// One request  (keep these LAST so "/project/..." and "/summary" are never mistaken for an id)
router.get ('/:id',          loadChangeRequest('id'),                  c.getOne);
router.post('/:id/comments', loadChangeRequest('id', { write: true }), c.comment);
router.post('/:id/approve',  loadChangeRequest('id', { write: true }), c.approve);
router.post('/:id/reject',   loadChangeRequest('id', { write: true }), c.reject);

module.exports = router;