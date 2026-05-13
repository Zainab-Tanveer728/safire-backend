// src/controllers/adminController.js
// All admin panel controller functions.
// Assumes your existing User model is at ../models/User
// and has fields: name, email, role, status, createdAt, bio, skills, location

const User = require("../models/User");
const AdminAuditLog = require("../models/AdminAuditLog");
const bcrypt = require("bcryptjs");

// ── Helper: build time range filter ─────────────────────────────────────────
function getDateFilter(range) {
  const now = new Date();
  const map = { "7d": 7, "30d": 30, "90d": 90 };
  const days = map[range] || 30;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { $gte: from };
}

// ── GET /api/admin/dashboard/metrics ────────────────────────────────────────
exports.getDashboardMetrics = async (req, res) => {
  try {
    const range = req.query.range || "30d";
    const dateFilter = getDateFilter(range);
    const prevFilter = getDateFilter(range === "7d" ? "14d" : range === "30d" ? "60d" : "180d");

    // Current period counts
    const [
      totalUsers,
      freelancers,
      clients,
      newUsersCurrent,
      newUsersPrev,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "freelancer" }),
      User.countDocuments({ role: "client" }),
      User.countDocuments({ createdAt: dateFilter }),
      User.countDocuments({ createdAt: prevFilter }),
    ]);

    const userChange = newUsersPrev > 0
      ? Math.round(((newUsersCurrent - newUsersPrev) / newUsersPrev) * 100)
      : 0;

    // User growth chart — last 6 months grouped by month
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const growthData = await User.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            role: "$role",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Transform to recharts format
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthMap = {};
    growthData.forEach(({ _id, count }) => {
      const key = `${monthNames[_id.month - 1]} ${_id.year}`;
      if (!monthMap[key]) monthMap[key] = { month: key, freelancers: 0, clients: 0 };
      if (_id.role === "freelancer") monthMap[key].freelancers += count;
      if (_id.role === "client") monthMap[key].clients += count;
    });
    const userGrowth = Object.values(monthMap);

    // Project activity — mock data (wire when Module 5 exists)
    const projectActivity = [
      { week: "Week 1", created: 0, completed: 0 },
      { week: "Week 2", created: 0, completed: 0 },
      { week: "Week 3", created: 0, completed: 0 },
      { week: "Week 4", created: 0, completed: 0 },
    ];

    // Recent activity — last 20 user registrations/updates
    const recentUsers = await User.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .select("name email role createdAt status");

    const recentActivity = recentUsers.map(u => ({
      type: "register",
      message: `${u.name} (${u.role}) joined the platform`,
      timestamp: u.createdAt,
    }));

    res.json({
      overview: {
        totalUsers,
        freelancers,
        clients,
        userChange,
        activeProjects: 0,     // Wire with Module 5
        projectChange: 0,
        disputesPending: 0,    // Wire with Module 5
        disputeChange: 0,
        platformHealth: 100,
        healthChange: 0,
      },
      userGrowth,
      projectActivity,
      recentActivity,
    });
  } catch (err) {
    console.error("getDashboardMetrics:", err);
    res.status(500).json({ message: "Failed to load dashboard metrics." });
  }
};

// ── GET /api/admin/users ─────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", role, status } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (role && role !== "all") filter.role = role;
    if (status && status !== "all") filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("name email role status createdAt location")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    // Overview counts (unfiltered for the metric cards)
    const [totalAll, totalFreelancers, totalClients, totalPending] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "freelancer" }),
      User.countDocuments({ role: "client" }),
      User.countDocuments({ status: "pending" }),
    ]);

    res.json({
      users,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      overview: {
        total: totalAll,
        freelancers: totalFreelancers,
        clients: totalClients,
        pending: totalPending,
      },
    });
  } catch (err) {
    console.error("getUsers:", err);
    res.status(500).json({ message: "Failed to load users." });
  }
};

// ── GET /api/admin/users/:id/profile ─────────────────────────────────────────
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -refreshToken");

    if (!user) return res.status(404).json({ message: "User not found." });

    // Build the profile response
    // Wire totalEarnings, projectCount, successRate, avgRating from Module 5 when available
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status || "active",
      bio: user.bio || null,
      skills: user.skills || [],
      location: user.location || null,
      professionalTitle: user.professionalTitle || null,
      isVerified: user.isVerified || false,
      createdAt: user.createdAt,

      // Stats — zero until wired with other modules
      totalEarnings: user.totalEarnings || 0,
      projectCount: user.projectCount || 0,
      successRate: user.successRate || 0,
      avgRating: user.avgRating || 0,

      // Recent activity derived from user creation + any audit logs
      recentActivity: [
        {
          message: `Account created with role: ${user.role}`,
          timestamp: user.createdAt,
        },
        ...(user.status === "suspended"
          ? [{ message: "Account was suspended by admin.", timestamp: user.updatedAt }]
          : []),
      ],
    });
  } catch (err) {
    console.error("getUserProfile:", err);
    res.status(500).json({ message: "Failed to load user profile." });
  }
};

// ── POST /api/admin/users ─────────────────────────────────────────────────────
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "name, email, password, and role are required." });
    }

    // Admin accounts can only be created via the createAdmin.js seed script.
    if (role === "admin") {
      return res.status(400).json({ message: "Cannot create admin accounts through this endpoint." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: "Email already in use." });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
      role,
      status: "active",
      isVerified: true,
    });

    await AdminAuditLog.create({
      adminId: req.user.id,
      action: "create",
      targetUserId: user._id,
      targetEmail: user.email,
      reason: "Manually created by admin",
    });

    res.status(201).json({ message: "User created successfully.", userId: user._id });
  } catch (err) {
    console.error("createUser:", err);
    res.status(500).json({ message: "Failed to create user." });
  }
};

// ── PATCH /api/admin/users/:id/suspend ───────────────────────────────────────
exports.suspendUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "suspended" },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found." });

    await AdminAuditLog.create({
      adminId: req.user.id,
      action: "suspend",
      targetUserId: user._id,
      targetEmail: user.email,
      reason: req.body.reason || "Suspended by admin",
    });

    res.json({ message: "User suspended.", userId: user._id });
  } catch (err) {
    console.error("suspendUser:", err);
    res.status(500).json({ message: "Failed to suspend user." });
  }
};

// ── PATCH /api/admin/users/:id/unsuspend ─────────────────────────────────────
exports.unsuspendUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "active" },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found." });

    await AdminAuditLog.create({
      adminId: req.user.id,
      action: "unsuspend",
      targetUserId: user._id,
      targetEmail: user.email,
    });

    res.json({ message: "User reactivated.", userId: user._id });
  } catch (err) {
    console.error("unsuspendUser:", err);
    res.status(500).json({ message: "Failed to reactivate user." });
  }
};

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    // Soft delete — preserve audit trail, just mark as removed
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "removed" },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found." });

    await AdminAuditLog.create({
      adminId: req.user.id,
      action: "delete",
      targetUserId: user._id,
      targetEmail: user.email,
      reason: req.body.reason || "Removed by admin",
    });

    res.json({ message: "User removed.", userId: user._id });
  } catch (err) {
    console.error("deleteUser:", err);
    res.status(500).json({ message: "Failed to remove user." });
  }
};  