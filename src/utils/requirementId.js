// src/utils/requirementId.js
// Creates the next 'RQ-001' style id for a project.
const ExtractedRequirement = require('../models/ExtractedRequirement');

const formatRequirementId = (n) => `RQ-${String(n).padStart(3, '0')}`;

// Looks at the ids already used in this project and returns the next number.
async function nextRequirementNumber(projectId) {
  const rows = await ExtractedRequirement.find({ project: projectId }).select('requirementId').lean();
  const used = rows
    .map((r) => parseInt(String(r.requirementId).replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n));
  return (used.length ? Math.max(...used) : 0) + 1;
}

module.exports = { formatRequirementId, nextRequirementNumber };