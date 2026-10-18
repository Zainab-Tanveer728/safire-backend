// src/services/meetingAiService.js
// The backend's phone line to the Python AI service (safire-ai).
// Uses YOUR models (Whisper + RoBERTa). Needs Node 18+.
const fs = require('fs');

const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

const QUICK_TIMEOUT_MS      = Number(process.env.AI_TIMEOUT_MS || 30 * 1000);              // health etc.
const EXTRACT_TIMEOUT_MS    = Number(process.env.AI_EXTRACT_TIMEOUT_MS || 2 * 60 * 1000);  // RoBERTa
const TRANSCRIBE_TIMEOUT_MS = Number(process.env.AI_TRANSCRIBE_TIMEOUT_MS || 10 * 60 * 1000); // Whisper

function needModernNode() {
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined')
    throw new Error('Node 18 or newer is required for the AI service calls. Run "node -v" to check.');
}

async function request(path, options = {}, timeoutMs = QUICK_TIMEOUT_MS) {
  needModernNode();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${AI_URL}${path}`, {
      ...options,
      headers: {
        'ngrok-skip-browser-warning': 'true',   // skips ngrok's warning page
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The AI service took too long to answer.');
    throw new Error(`Cannot reach the AI service at ${AI_URL}. Are safire-ai and ngrok running?`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : text.slice(0, 200);
    throw new Error(`AI service error (${res.status}): ${detail}`);
  }
  return data;
}

// tracks = [{ filePath, filename, speaker: 'Client'|'Freelancer', offsetSec }]
async function transcribe(tracks) {
  needModernNode();
  const form = new FormData();
  for (const t of tracks) {
    const buffer = await fs.promises.readFile(t.filePath);
    form.append('files', new Blob([buffer]), t.filename);
  }
  form.append('speakers', tracks.map((t) => t.speaker).join(','));
  form.append('offsets',  tracks.map((t) => t.offsetSec || 0).join(','));
  return request('/api/transcribe', { method: 'POST', body: form }, TRANSCRIBE_TIMEOUT_MS);
}

// segments = [{ segmentId, speaker, startTime, endTime, text }]
async function extractRequirements(segments, minConfidence) {
  const body = { segments };
  if (minConfidence !== undefined) body.minConfidence = minConfidence;
  return request('/api/extract-requirements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, EXTRACT_TIMEOUT_MS);
}

async function health() {
  return request('/api/meeting/health');
}

module.exports = { transcribe, extractRequirements, health, AI_URL };