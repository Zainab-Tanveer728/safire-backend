// src/models/AdminAuditLog.js
const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action:       { type: String, required: true }, // "suspend", "unsuspend", "delete", "create"
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    targetEmail:  { type: String },
    reason:       { type: String },
    metadata:     { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminAuditLog", adminAuditLogSchema);