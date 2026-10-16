// src/services/storageService.js
// ONE place that knows where files live. Today: your computer's disk.
// Later: S3 / Cloudflare R2 -> only this file changes, no controller does.
//
// Audio goes in "private_uploads/" (NOT in "uploads/"), because "uploads/" may be
// served publicly by app.js. Recordings of private meetings must never be public.
const fs   = require('fs');
const path = require('path');

const DRIVER = process.env.STORAGE_DRIVER || 'local';
const ROOT   = path.resolve(process.env.UPLOAD_ROOT || path.join(__dirname, '..', '..', 'private_uploads'));

// Turns a storage key ('meetings/abc/client.webm') into a real path
// and refuses anything that tries to escape the folder (../../..).
function safePath(key) {
  const full = path.resolve(ROOT, String(key));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw new Error('Invalid storage key.');
  return full;
}

function assertLocal() {
  if (DRIVER !== 'local') throw new Error(`Storage driver "${DRIVER}" is not set up yet.`);
}

// Moves a freshly uploaded temp file into its final place. Returns the key.
async function put(tempPath, key) {
  assertLocal();
  const dest = safePath(key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.rename(tempPath, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;           // different disk: copy then delete
    await fs.promises.copyFile(tempPath, dest);
    await fs.promises.unlink(tempPath);
  }
  return key;
}

// Real path on disk (used to send the file to the AI service or play it back).
async function getLocalPath(key) {
  assertLocal();
  const p = safePath(key);
  await fs.promises.access(p);                      // throws if the file is missing
  return p;
}

async function remove(key) {
  if (!key) return;
  assertLocal();
  try { await fs.promises.unlink(safePath(key)); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
}

async function exists(key) {
  try { await getLocalPath(key); return true; } catch { return false; }
}

module.exports = { put, getLocalPath, remove, exists, driver: DRIVER, root: ROOT };