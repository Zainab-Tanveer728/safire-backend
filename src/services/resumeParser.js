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

async function extractResumeText(filePath) {
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
  return { text, type, ext: path.extname(filePath).toLowerCase() };
}

module.exports = { extractResumeText, ResumeError, clean };