// Reads the text out of an uploaded resume (PDF or DOCX).
const fs   = require('fs');
const path = require('path');

// pdf-parse changed its API between version 1 (a function) and version 2 (a PDFParse class).
// This works with both, so it does not matter which one is installed.
async function pdfToText(buffer) {
  const mod = require('pdf-parse');

  if (typeof mod === 'function') {                                   // version 1
    const result = await mod(buffer);
    return result.text || '';
  }
  const PDFParse = mod.PDFParse || (mod.default && mod.default.PDFParse);
  if (typeof PDFParse === 'function') {                              // version 2
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      if (typeof parser.destroy === 'function') await parser.destroy();
    }
  }
  if (mod.default && typeof mod.default === 'function') {
    const result = await mod.default(buffer);
    return result.text || '';
  }
  throw new Error('Unsupported pdf-parse version');
}

// file = req.file from multer. Throws if the type is not supported or the file cannot be read.
exports.extractResumeText = async (file) => {
  const ext = path.extname(file.originalname || file.path).toLowerCase();

  if (ext === '.pdf') {
    return pdfToText(fs.readFileSync(file.path));
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ path: file.path });
    return result.value || '';
  }
  throw new Error('Unsupported file type');
};