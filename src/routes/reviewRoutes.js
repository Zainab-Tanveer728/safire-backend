// src/routes/reviewRoutes.js  (NEW)   mounted at /api   -> app.use('/api', require('./routes/reviewRoutes'));
// Mount it BEFORE your own project routes so POST /api/projects/:id/complete is found.
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/reviewController');

const d = require('../controllers/deliveryController');
const e = require('../controllers/projectEndController');
const { uploadDelivery } = require('../config/deliveryUpload');
router.get ('/projects/:id/cancel-request', protect, e.get);
router.post('/projects/:id/cancel-request', protect, e.request);
router.post('/projects/:id/cancel-request/respond', protect, e.respond);
router.post('/projects/:id/cancel-request/withdraw', protect, e.withdraw);
router.post('/projects/:id/complete', protect, c.completeProject);
router.get ('/projects/:id/deliveries', protect, d.list);
router.post('/projects/:id/deliveries', protect, uploadDelivery, d.submit);
router.get ('/projects/:id/deliveries/:did/file', protect, d.download);
router.post('/projects/:id/deliveries/:did/accept', protect, d.accept);
router.post('/projects/:id/deliveries/:did/revision', protect, d.revision);
router.get ('/projects/:id/reviews',  protect, c.projectReviews);
router.post('/projects/:id/reviews',  protect, c.createReview);
router.post('/reviews/:reviewId/reply', protect, c.reply);
router.post('/reviews/:reviewId/report', protect, c.report);
router.patch('/reviews/:reviewId/hide', protect, c.hide);
router.get ('/reviews/user/:userId',  protect, c.userReviews);
module.exports = router;