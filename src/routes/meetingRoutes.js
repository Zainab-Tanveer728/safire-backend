// src/routes/meetingRoutes.js   (mounted at /api/meetings)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadProject, loadMeeting } = require('../middleware/projectAccess');
const { uploadAudio } = require('../config/audioUpload');
const c = require('../controllers/meetingController');

// Public (no login): shared transcript link. Keep ABOVE router.use(protect).
router.get('/shared/:token', c.getSharedTranscript);

router.use(protect);

// All my meetings (keep ABOVE '/:id')
router.get ('/',                         c.listMyMeetings);

// By project
router.post('/projects/:projectId', loadProject('projectId', { write: true }), c.createMeeting);
router.get ('/projects/:projectId', loadProject('projectId'),                  c.listMeetings);

// One meeting
router.get ('/:id',            loadMeeting('id'),                  c.getMeeting);
router.get ('/:id/ice',        loadMeeting('id'),                  c.getIceServers);
router.post('/:id/consent',    loadMeeting('id', { write: true }), c.giveConsent);
router.post('/:id/start',      loadMeeting('id', { write: true }), c.startMeeting);
router.post('/:id/end',        loadMeeting('id', { write: true }), c.endMeeting);
router.post('/:id/audio',      loadMeeting('id', { write: true }), uploadAudio, c.uploadAudio);
router.get ('/:id/audio/:trackId', loadMeeting('id'),              c.streamAudio);
router.post('/:id/process',    loadMeeting('id', { write: true }), c.processMeeting);
router.get ('/:id/transcript', loadMeeting('id'),                  c.getTranscript);
router.post('/:id/share',      loadMeeting('id', { write: true }), c.shareTranscript);

module.exports = router;