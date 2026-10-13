const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const c = require('../controllers/proposalController');
const h = require('../controllers/highlightsController');

router.use(protect, restrictTo('freelancer'));

// Profile highlights from resume / GitHub (keep above the '/:id' routes)
router.post('/highlights/extract', h.uploadResume, h.extract);

router.post('/generate', c.generate);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.put('/:id', c.update);
router.post('/:id/regenerate', c.regenerate);
router.patch('/:id/submit', c.submit);
router.delete('/:id', c.remove);

module.exports = router;