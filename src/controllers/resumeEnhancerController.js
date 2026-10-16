// Resume Enhancer (Module 2, FE-2 / mockup M20)
// Flow: upload or pasted text -> Python AI service scores it and suggests edits -> we save a ResumeVersion
//       (the original is never overwritten) -> the freelancer accepts / reverts edits -> "apply" saves the result.
const fs       = require('fs');
const mongoose = require('mongoose');

const User          = require('../models/User');
const ResumeVersion = require('../models/resumeVersion');
const aiService     = require('../services/aiService');
const { extractResumeText } = require('../utils/extractResumeText');

const MAX_CHARS = 30000;
const MAX_ROLES = 3;

// ── helpers ───────────────────────────────────────────────────────────────────
// "Full Stack Developer, Backend Developer" -> ['Full Stack Developer', 'Backend Developer']   (FR20.3)
function parseRoles(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(list.map((r) => String(r).trim()).filter(Boolean))];
}

const profileSkillNames = (user) => (user.skills || []).map((s) => s && s.name).filter(Boolean);

function removeFile(file) {
  try { if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
}

// The AI service uses snake_case, the frontend camelCase. The old field names (beforeScore, enhancedContent ...)
// are kept too, so the previous version of the page does not break.
function shapeEnhance(r) {
  const out = {
    resumeText:   r.resume_text,
    enhancedText: r.enhanced_text,
    targetRoles:  (r.roles || []).map((x) => x.title),
    before:       r.before,
    after:        r.after,
    improvement:  r.after.overall - r.before.overall,
    suggestions:  r.suggestions,
    changes:      (r.changes || []).map((c) => ({ id: c.id, type: c.type, original: c.original, improved: c.improved, reason: c.reason })),
    keywordReport: shapeKeywords(r.keyword_report),
    confidence:   r.confidence,
    aiGenerated:  r.ai_generated === true,
    warnings:     r.warnings || [],
    processingMs: r.processing_ms,
  };
  Object.assign(out, {
    beforeScore: r.before.overall,    afterScore: r.after.overall,
    beforeKeywords: r.before.keywords ?? 0,   afterKeywords: r.after.keywords ?? 0,
    beforeStructure: r.before.structure,      afterStructure: r.after.structure,
    enhancedContent: r.enhanced_text,
  });
  return out;
}

function shapeScore(r) {
  return {
    scores:        r.scores,
    suggestions:   r.suggestions,
    keywordReport: shapeKeywords(r.keyword_report),
    targetRoles:   (r.roles || []).map((x) => x.title),
    confidence:    r.confidence,
    aiGenerated:   r.ai_generated === true,
    processingMs:  r.processing_ms,
  };
}

function shapeKeywords(k) {
  return {
    found:   (k && k.found) || [],
    missing: ((k && k.missing) || []).map((m) => ({ skill: m.skill, tier: m.tier, inProfile: !!m.in_profile })),
  };
}

// AI service answered 422 (input problem the user can fix) or is down
function sendAiError(res, err, what) {
  if (err.status === 422) {
    return res.status(422).json({ message: err.message, code: err.code, suggestions: err.suggestions || [] });
  }
  console.error(`${what} AI error:`, err.message);
  return res.status(503).json({ message: `${what} is temporarily unavailable. Please try again in a moment.` });
}

function checkText(text) {
  if (!text.trim()) return 'Please upload your resume or paste its text.';
  if (text.length > MAX_CHARS) return `Your resume is too long (maximum ${MAX_CHARS.toLocaleString('en-US')} characters).`;
  return null;
}

// ── POST /api/freelancer/enhance-resume  (multipart "resume" file, or JSON { resumeText, targetRole }) ──
exports.enhanceResume = async (req, res) => {
  try {
    const roles = parseRoles(req.body?.targetRole);
    if (roles.length > MAX_ROLES) {
      return res.status(400).json({ message: `Please enter at most ${MAX_ROLES} roles.` });
    }

    let resumeText = '';
    let sourceType = 'paste';
    if (req.file) {
      sourceType = 'upload';
      try {
        resumeText = await extractResumeText(req.file);
      } catch (err) {
        console.error('Resume text extraction failed:', err.message);
        return res.status(422).json({ message: 'We could not read this file. Try another PDF or DOCX, or paste the text instead.' });
      }
      if (!resumeText.trim()) {
        return res.status(422).json({ message: 'We could not find any text in this file (is it a scanned PDF?). Please paste your resume text instead.' });
      }
    } else {
      resumeText = String(req.body?.resumeText || '');
    }

    const problem = checkText(resumeText);
    if (problem) return res.status(400).json({ message: problem });

    let result;
    try {
      result = await aiService.enhanceResume({ resumeText, targetRoles: roles, profileSkills: profileSkillNames(req.user) });
    } catch (err) {
      return sendAiError(res, err, 'Resume enhancement');
    }

    const shaped = shapeEnhance(result);

    let versionId = null;   // a failed save must not hide a good result from the freelancer
    try {
      const version = await ResumeVersion.create({
        freelancer:   req.user._id,
        sourceType,
        fileName:     req.file?.originalname,
        targetRoles:  shaped.targetRoles,
        originalText: shaped.resumeText,
        enhancedText: shaped.enhancedText,
        scores:       { before: shaped.before, after: shaped.after },
        changes:      shaped.changes.map((c) => ({ ...c, status: 'pending' })),
        suggestions:  shaped.suggestions,
        confidence:   shaped.confidence,
        aiGenerated:  shaped.aiGenerated,
        fullResult:   shaped,
      });
      versionId = version._id;
    } catch (err) {
      console.error('Resume version save failed:', err.message);
    }

    res.json({ success: true, versionId, ...shaped });
  } catch (err) {
    console.error('Enhance resume error:', err.message);
    res.status(500).json({ message: 'Resume enhancement failed. Please try again.' });
  } finally {
    removeFile(req.file);
  }
};

// ── POST /api/freelancer/resume/score  { resumeText, targetRole }  (Re-analyse: fast, no language model) ──
exports.scoreResume = async (req, res) => {
  try {
    const roles = parseRoles(req.body?.targetRole);
    if (roles.length > MAX_ROLES) {
      return res.status(400).json({ message: `Please enter at most ${MAX_ROLES} roles.` });
    }
    const resumeText = String(req.body?.resumeText || '');
    const problem = checkText(resumeText);
    if (problem) return res.status(400).json({ message: problem });

    let result;
    try {
      result = await aiService.scoreResume({ resumeText, targetRoles: roles, profileSkills: profileSkillNames(req.user) });
    } catch (err) {
      return sendAiError(res, err, 'Resume analysis');
    }
    res.json({ success: true, ...shapeScore(result) });
  } catch (err) {
    console.error('Score resume error:', err.message);
    res.status(500).json({ message: 'Resume analysis failed. Please try again.' });
  }
};

// ── POST /api/freelancer/resume/versions/:id/apply ─────────────────────────────
// body: { finalText, accepted: ['c1'], rejected: ['c2'], setAsActive: true }
// Saves what the freelancer kept. Only with setAsActive does it replace their active resume text.
exports.applyResumeVersion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Resume version not found.' });

    const finalText = String(req.body?.finalText || '');
    const problem = checkText(finalText);
    if (problem) return res.status(400).json({ message: problem });

    const ids = (v) => (Array.isArray(v) ? v.map(String).slice(0, 50) : []);
    const accepted = ids(req.body?.accepted);
    const rejected = ids(req.body?.rejected);
    const setAsActive = req.body?.setAsActive === true;

    const version = await ResumeVersion.findOne({ _id: id, freelancer: req.user._id });
    if (!version) return res.status(404).json({ message: 'Resume version not found.' });

    version.changes.forEach((c) => {
      if (accepted.includes(c.id)) c.status = 'accepted';
      else if (rejected.includes(c.id)) c.status = 'rejected';
    });
    version.finalText = finalText;
    version.feedback  = { accepted: accepted.length, rejected: rejected.length };

    // Score the final text again, so the saved score matches what was really kept (best effort)
    let finalScores = null;
    try {
      const scored = await aiService.scoreResume({
        resumeText: finalText, targetRoles: version.targetRoles, profileSkills: profileSkillNames(req.user),
      });
      finalScores = scored.scores;
      version.scores = { ...(version.scores?.toObject ? version.scores.toObject() : version.scores), final: finalScores };
    } catch (err) {
      console.error('Final resume score failed:', err.message);
    }

    if (setAsActive) {
      await User.findByIdAndUpdate(req.user._id, { $set: { resumeText: finalText } });
      version.activated = true;
    }
    await version.save();

    console.log(`📝 Resume version ${id}: ${accepted.length} edits kept, ${rejected.length} reverted${setAsActive ? ', saved as active resume' : ''}`);
    res.json({
      success: true, versionId: version._id,
      accepted: accepted.length, rejected: rejected.length,
      finalScores, activeUpdated: setAsActive,
    });
  } catch (err) {
    console.error('Apply resume version error:', err.message);
    res.status(500).json({ message: 'Could not save your resume. Please try again.' });
  }
};