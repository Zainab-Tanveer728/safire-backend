// src/services/resumeParser.js
// Turns an uploaded resume (PDF or DOCX) into clean plain text, so the AI can read it.
// Until now nothing did this: the upload only saved the file, user.resumeText stayed empty,
// and the AI step never saw the resume.
//
// npm i pdf-parse@2.4.5 mammoth
const fs = require('fs/promises');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const MAX_CHARS = 20000;   // enough for any resume, keeps the database small
const MIN_CHARS = 80;      // fewer than this means "no readable text" (for example a scanned image)

class ResumeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Check the first bytes of the file, because the MIME type and the extension can be faked.
function detectType(buf) {
  if (buf.length > 4 && buf.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'docx';                              // "PK" (zip)
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
  return null;
}

function clean(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/^\s*-- \d+ of \d+ --\s*$/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}


// ── Is this document actually a resume? ───────────────────────────────────────
// A PDF or DOCX of ANY kind has readable text, so reading text proves nothing.
// A resume has a recognisable shape: section headings (Education, Skills, ...) and contact details.
// Each kind of evidence is counted once, so a long document cannot pass by repeating one word.
const SECTION_GROUPS = [
  /^(work\s+|professional\s+|relevant\s+|employment\s+)?(experience|history)$|^employment(\s+history)?$|^internships?$/,
  /^(education|academic(s)?|academic\s+(background|qualifications?)|qualifications?|educational\s+background)$/,
  /^((technical|key|core|professional|soft)\s+)?(skills?|competenc(y|ies)|technologies|tech\s+stack)(\s*(&|and)\s*\w+)?$|^skills?\s+summary$/,
  /^((personal|academic|final\s+year|key|selected|side)\s+)?projects?$|^final\s+year\s+project$/,
  /^(certifications?|certificates?|courses|training|licen[cs]es)(\s*(&|and)\s*\w+)?$/,
  /^((professional|career)\s+)?(summary|profile|objective)$|^career\s+objective$|^about\s+me$|^personal\s+(statement|profile)$/,
  /^(achievements?|awards?|honou?rs|accomplishments|publications?|volunteer(ing)?(\s+experience)?|extracurricular(\s+activities)?|activities)$/,
  /^(languages?|interests|hobbies(\s*(&|and)\s*interests)?|references?|personal\s+(details|information))$/,
];

const HAS_EMAIL    = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// a phone number has 10 to 15 digits; this stops a year range like "2021 - 2025" counting as one
const hasPhone = (t) => (String(t).match(/\+?\d[\d\s().-]{8,}\d/g) || []).some((m) => {
  const digits = m.replace(/\D/g, '').length;
  return digits >= 10 && digits <= 15;
});
const HAS_PROFILE  = /(linkedin\.com|github\.com|behance\.net|dribbble\.com|portfolio)/i;
const HAS_DATES    = /\b(19|20)\d{2}\s*(-|–|—|to)\s*((19|20)\d{2}|present|current|now|ongoing|date)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\s*(-|–|—|to)/i;
const HAS_DEGREE   = /\b(bachelor|b\.?\s?sc|b\.?\s?s\b|bs\s?(cs|se|it)|bscs|bsse|master|m\.?\s?sc|phd|degree|university|college|cgpa|gpa|intermediate|matriculation|diploma|fsc|a-levels?)\b/i;
const SLIDE_WORDS  = /\b(agenda|slide\s*\d*|thank\s+you|q\s*&\s*a|questions\?|quarterly|roadmap|invoice|bill\s+to|total\s+due|abstract|table\s+of\s+contents)\b/i;

function resumeEvidence(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const groups = new Set();
  lines.forEach((line) => {
    if (line.length > 45) return;   // headings are short
    const norm = (t) => t.toLowerCase().replace(/[:\u2013\u2014\-|•*#_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    const candidates = [norm(line)];
    const lead = line.match(/^([A-Za-z &]{3,30}?)\s*[:\u2013\u2014-]\s*\S/);   // "Skills: JavaScript, React"
    if (lead) candidates.push(norm(lead[1]));
    SECTION_GROUPS.forEach((re, i) => { if (candidates.some((c) => re.test(c))) groups.add(i); });
  });
  const flags = {
    email: HAS_EMAIL.test(text),
    phone: hasPhone(text),
    profile: HAS_PROFILE.test(text),
    dates: HAS_DATES.test(text),
    degree: HAS_DEGREE.test(text),
  };
  const contact = [flags.email, flags.phone, flags.profile].filter(Boolean).length;
  const other = [flags.dates, flags.degree].filter(Boolean).length;
  // headings count double, because they are the strongest sign of a resume
  const score = groups.size * 2 + contact + other - (SLIDE_WORDS.test(text) && groups.size < 3 ? 1 : 0);
  return { sections: groups.size, contact, other, score };
}

// A resume needs at least 2 different section headings AND some contact or date evidence.
function looksLikeResume(text) {
  const e = resumeEvidence(text);
  return { ok: e.sections >= 2 && e.score >= 5 && e.contact + e.other >= 1, ...e };
}

async function extractResumeText(filePath, { requireResume = true } = {}) {
  const buf = await fs.readFile(filePath);
  const type = detectType(buf);

  if (!type) throw new ResumeError('BAD_FILE', 'This file is not a real PDF or Word document.');
  if (type === 'doc') {
    throw new ResumeError('OLD_DOC', 'Old .doc files cannot be read. Please save it as .docx or PDF and upload again.');
  }

  let raw = '';
  try {
    if (type === 'pdf') {
      const parser = new PDFParse({ data: buf });
      try {
        raw = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      raw = (await mammoth.extractRawText({ buffer: buf })).value;
    }
  } catch (err) {
    throw new ResumeError('UNREADABLE', 'We could not read this file. It may be damaged or password protected.');
  }

  const text = clean(raw);
  if (text.length < MIN_CHARS) {
    throw new ResumeError(
      'NO_TEXT',
      'No readable text was found. If this is a scanned image, upload a PDF or Word file that contains real text.'
    );
  }

  // far longer than any resume (a report, a book, slides exported as text)
  if (requireResume && String(raw).length > 60000) {
    throw new ResumeError('NOT_RESUME', 'This file is too long to be a resume. Please upload your resume only.');
  }
  if (requireResume) {
    const check = looksLikeResume(text);
    if (!check.ok) {
      throw new ResumeError(
        'NOT_RESUME',
        'This does not look like a resume. A resume has sections such as Education, Experience, Projects or Skills, and your contact details. Please upload your resume.'
      );
    }
  }
  return { text, type, ext: path.extname(filePath).toLowerCase() };
}

module.exports = { extractResumeText, ResumeError, clean, looksLikeResume };