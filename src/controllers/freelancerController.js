const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

async function callAI(endpoint, body) {
  const res = await fetch(`${AI_URL}/api/freelancer/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI service error: ${res.status}`);
  return res.json();
}

// ────────────────────────────────────────────────────────────────
//  FR2.1 — Generate AI Proposal
// ────────────────────────────────────────────────────────────────
exports.generateProposal = async (req, res) => {
  try {
    const { jobDescription, profileHighlights, tone } = req.body;

    if (!jobDescription?.trim()) {
      return res.status(400).json({ message: 'Job description is required.' });
    }

    console.log("📨 Calling AI with:", { jobDescription, profileHighlights, tone });
    const result = await callAI('generate-proposal', { jobDescription, profileHighlights, tone });
    console.log("✅ AI result:", result);

    return res.json(result);
  } catch (err) {
    console.error("❌ generateProposal error:", err.message);
    res.status(500).json({ message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
//  FR2.3 — Skill Gap Analysis
// ────────────────────────────────────────────────────────────────
exports.analyseSkillGap = async (req, res) => {
  try {
    const { targetRole, sources = ['Profile'] } = req.body;
    const user = req.user;

    if (!targetRole?.trim()) {
      return res.status(400).json({ message: 'Target role is required.' });
    }

    const userSkills = user.skills?.map(s => s.name || s) || [];

    console.log("📨 Skill gap request:", { targetRole, userSkills });
    const result = await callAI('skill-gap', { targetRole, userSkills });
    console.log("✅ Skill gap result:", result);

    return res.json(result);
  } catch (err) {
    console.error('❌ analyseSkillGap error:', err.message);
    res.status(500).json({ message: 'Skill gap analysis failed. Please try again.' });
  }
};

// ────────────────────────────────────────────────────────────────
//  FR2.2 — Resume Enhancement
// ────────────────────────────────────────────────────────────────
exports.enhanceResume = async (req, res) => {
  try {
    let resumeContent = '';
    const targetRole = req.body.targetRole || '';

    if (req.file) {
      const fs   = require('fs');
      const path = require('path');
      const filePath = req.file.path;
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === '.pdf') {
        const pdfParse  = require('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData   = await pdfParse(dataBuffer);
        resumeContent   = pdfData.text;
      } else if (ext === '.docx') {
        const mammoth = require('mammoth');
        const result  = await mammoth.extractRawText({ path: filePath });
        resumeContent = result.value;
      }

      fs.unlinkSync(filePath);
    } else if (req.body.resumeText) {
      resumeContent = req.body.resumeText;
    }

    if (!resumeContent?.trim()) {
      return res.status(400).json({ message: 'Resume content is required.' });
    }

    console.log("📨 Enhance resume request:", { targetRole, length: resumeContent.length });
    const result = await callAI('enhance-resume', { resumeText: resumeContent, targetRole });
    console.log("✅ Resume result:", result);

    return res.json(result);
  } catch (err) {
    console.error('❌ enhanceResume error:', err.message);
    res.status(500).json({ message: 'Resume enhancement failed. Please try again.' });
  }
};

// ────────────────────────────────────────────────────────────────
//  FR2.4 — Gig Optimization
// ────────────────────────────────────────────────────────────────
exports.optimizeGig = async (req, res) => {
  try {
    const { gigType, experienceLevel = 'Intermediate', skills = [] } = req.body;

    if (!gigType?.trim()) {
      return res.status(400).json({ message: 'Gig type is required.' });
    }

    console.log("📨 Optimize gig request:", { gigType, experienceLevel, skills });
    const result = await callAI('optimize-gig', { gigType, experienceLevel, skills });
    console.log("✅ Gig result:", result);

    return res.json(result);
  } catch (err) {
    console.error('❌ optimizeGig error:', err.message);
    res.status(500).json({ message: 'Gig optimization failed. Please try again.' });
  }
};