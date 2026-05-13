// src/routes/adminRoutes.js

const express = require('express');
const router  = express.Router();

const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const adminGuard = [protect, restrictTo('admin')];

// ── PING ──────────────────────────────────────────────────────────────────────
router.get('/ping', async (req, res) => {
  try {
    const count = await User.countDocuments({ role: { $ne: 'admin' } });
    res.json({ ok: true, nonAdminUserCount: count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/admin/dashboard/stats ────────────────────────────────────────────
router.get('/dashboard/stats', ...adminGuard, async (req, res) => {
  try {
    // Base filter: never count admin accounts in platform stats
    const NON_ADMIN = { role: { $ne: 'admin' } };

    const [
      totalUsers,
      totalFreelancers,
      totalClients,
      verifiedUsers,
      suspendedUsers,
      pendingUsers,
      newUsersThisWeek,
    ] = await Promise.all([
      User.countDocuments(NON_ADMIN),
      User.countDocuments({ role: 'freelancer' }),
      User.countDocuments({ role: 'client' }),
      User.countDocuments({
        ...NON_ADMIN,
        $or: [
          { isEmailVerified: true },
          { isVerified:      true },
          { emailVerified:   true },
          { verified:        true },
        ],
      }),
      User.countDocuments({ ...NON_ADMIN, status: 'suspended' }),
      User.countDocuments({
        ...NON_ADMIN,
        status: { $ne: 'suspended' },
        $or: [
          { isEmailVerified: { $ne: true } },
          { isEmailVerified: { $exists: false } },
        ],
      }),
      User.countDocuments({
        ...NON_ADMIN,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    // Proposals
    let proposalsGenerated = 0;
    for (const name of ['Proposal', 'ProposalResult', 'GeneratedProposal', 'AIProposal']) {
      try { proposalsGenerated = await require(`../models/${name}`).countDocuments({}); break; } catch (_) {}
    }

    // Active projects
    let activeProjects = 0;
    for (const name of ['Project', 'ProjectModel']) {
      try { activeProjects = await require(`../models/${name}`).countDocuments({ status: 'active' }); break; } catch (_) {}
    }

    console.log('[Admin Stats]', { totalUsers, totalFreelancers, totalClients, verifiedUsers, suspendedUsers, pendingUsers, newUsersThisWeek, proposalsGenerated, activeProjects });

    res.json({
      totalUsers,
      totalFreelancers,
      totalClients,
      verifiedUsers,
      suspendedUsers,
      pendingUsers,
      newUsersThisWeek,
      proposalsGenerated,
      activeProjects,
    });
  } catch (err) {
    console.error('[Admin Stats Error]', err);
    res.status(500).json({ message: 'Failed to fetch stats', error: err.message });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', ...adminGuard, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', role = 'all', status = 'all' } = req.query;

    // Always exclude admins from the user list
    const query = { role: { $ne: 'admin' } };

    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    // If a role filter is selected, override the $ne with the exact role
    // (role filter will never be 'admin' since we don't expose that option)
    if (role !== 'all') query.role = role;
    if (status !== 'all') query.status = status;

    const [users, total, freelancers, clients, pending] = await Promise.all([
      User.find(query)
          .select('-password -__v')
          .sort({ createdAt: -1 })
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .lean(),
      User.countDocuments(query),
      User.countDocuments({ role: 'freelancer' }),
      User.countDocuments({ role: 'client' }),
      User.countDocuments({
        role: { $ne: 'admin' },
        status: { $ne: 'suspended' },
        $or: [
          { isEmailVerified: { $ne: true } },
          { isEmailVerified: { $exists: false } },
        ],
      }),
    ]);

    res.json({
      users,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      overview: {
        total: await User.countDocuments({ role: { $ne: 'admin' } }),
        freelancers,
        clients,
        pending,
      },
    });
  } catch (err) {
    console.error('[Admin Users Error]', err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

// ── GET /api/admin/users/:userId ──────────────────────────────────────────────
router.get('/users/:userId', ...adminGuard, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password -__v').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      ...user,
      projectCount:   0,
      totalEarnings:  0,
      successRate:    0,
      avgRating:      0,
      recentActivity: [
        { message: `Account created with role: ${user.role}`, timestamp: user.createdAt },
        ...(user.status === 'suspended'
          ? [{ message: 'Account was suspended by admin.', timestamp: user.updatedAt }]
          : []),
      ],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/admin/users ─────────────────────────────────────────────────────
router.post('/users', ...adminGuard, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'name, email and password are required' });
    if (role === 'admin')
      return res.status(400).json({ message: 'Cannot create admin via this endpoint.' });
    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email already in use' });

    const bcrypt = require('bcryptjs');
    const user = await User.create({
      name,
      email,
      password:   await bcrypt.hash(password, 10),
      role:       role || 'freelancer',
      isVerified: false,
    });
    const { password: _, ...out } = user.toObject();
    res.status(201).json(out);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT suspend / unsuspend ───────────────────────────────────────────────────
router.put('/users/:userId/suspend', ...adminGuard, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'suspended' }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User suspended', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/users/:userId/unsuspend', ...adminGuard, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { status: 'active' }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User reactivated', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/users/:userId', ...adminGuard, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { status: 'deleted', deletedAt: new Date() });
    res.json({ message: 'User removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;