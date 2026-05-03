const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const fs       = require('fs');
const path     = require('path');
const User     = require('../models/User');

// ── Keywords that must appear in a real resume ────────────────────
const RESUME_KEYWORDS = [
  'experience', 'education', 'skills', 'work', 'project',
  'university', 'college', 'degree', 'internship', 'employment',
  'certificate', 'bachelor', 'master', 'objective', 'summary',
  'position', 'developer', 'engineer', 'designed', 'developed',
  'managed', 'achieved', 'responsibilities',
];

const isLegitimateResume = (text) => {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Must have at least 100 words
  if (wordCount < 100) return { valid: false, reason: 'Document is too short to be a resume (minimum 100 words).' };

  // Must contain at least 13 resume-related keywords
  const foundKeywords = RESUME_KEYWORDS.filter(kw => lower.includes(kw));
  if (foundKeywords.length < 13) return { valid: false, reason: 'This document does not appear to be a resume. Please upload your actual CV or resume.' };

  return { valid: true };
};

exports.uploadResume = async (req, res) => {
  const filePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { mimetype, path: filePath, filename } = req.file;
    const buffer = fs.readFileSync(filePath);
    let text = '';

    // ── Extract text based on file type ──────────────────────────
    if (mimetype === 'application/pdf') {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else {
      // Word doc (.doc or .docx)
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    }

    // ── Validate it's actually a resume ──────────────────────────
    const validation = isLegitimateResume(text);
    if (!validation.valid) {
      // Delete the uploaded file since it's not valid
      fs.unlinkSync(filePath);
      return res.status(422).json({
        success: false,
        message: validation.reason,
      });
    }

    // ── Save to database ─────────────────────────────────────────
    const resumeUrl = `/uploads/resumes/${filename}`;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        resumeText: text,
        resumeUrl:  resumeUrl,
      }
    });

    console.log(`📄 Resume saved for user ${req.user._id} — ${text.split(/\s+/).length} words extracted`);

    res.json({
      success:  true,
      message:  'Resume uploaded and verified successfully.',
      wordCount: text.split(/\s+/).filter(Boolean).length,
      preview:  text.slice(0, 200),
    });

  } catch (err) {
    // Clean up file if something went wrong
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Resume upload error:', err.message);
    res.status(500).json({ success: false, message: 'Resume parsing failed: ' + err.message });
  }
};