// src/routes/jobRoutes.js   (REPLACE the earlier version; mounted at /api/jobs)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/jobController');

const only = (role) => (req, res, next) =>
  req.user && req.user.role === role ? next() : res.status(403).json({ message: `Only ${role}s can do this.` });

router.use(protect);

router.post('/',                              only('client'),     c.createJob);
router.get ('/',                              c.listJobs);   // clients: own jobs, freelancers: open jobs

// keep these BEFORE "/:id" so "applications" is never read as a job id
router.get ('/inbox',                                c.inbox);
router.get ('/applications/mine',                    only('freelancer'), c.myApplications);
router.get ('/applications/:appId',                                      c.getApplication);      // client or freelancer (marks "viewed")
router.post('/applications/:appId/messages',                             c.postMessage);         // client or freelancer
router.post('/applications/:appId/withdraw',         only('freelancer'), c.withdraw);
router.post('/applications/:appId/decline',          only('freelancer'), c.decline);             // invitation or offer
router.post('/applications/:appId/offer/accept',     only('freelancer'), c.acceptOffer);         // creates the project
router.post('/applications/:appId/shortlist',        only('client'),     c.shortlist);
router.post('/applications/:appId/reject',           only('client'),     c.reject);
router.post('/applications/:appId/offer',            only('client'),     c.sendOffer);
router.post('/applications/:appId/offer/withdraw',   only('client'),     c.withdrawOffer);

router.get ('/:id',                           c.getJob);
router.put ('/:id',                           only('client'),     c.updateJob);
router.delete('/:id',                         only('client'),     c.deleteDraft);
router.post('/:id/close',                     only('client'),     c.closeJob);
router.post('/:id/invite',                    only('client'),     c.invite);
router.post('/:id/apply',                     only('freelancer'), c.apply);
router.get ('/:id/applications',              only('client'),     c.listApplications);

module.exports = router;