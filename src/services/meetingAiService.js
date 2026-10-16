// src/services/meetingAiService.js
// The backend's phone line to the Python AI service (safire-ai, port 8001).
// Uses YOUR models (Whisper + RoBERTa). No Gemini / Groq / outside API.
// Needs Node 18+ (built-in fetch, FormData, Blob).
const fs   = require('fs');

const AI_URL     = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 10 * 60 * 1000);   // Whisper can take minutes

function needModernNode() {
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined')
    throw new Error('Node 18 or newer is required for the AI service calls. Run "node -v" to check.');
}

async function request(path, options = {}) {
  needModernNode();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${AI_URL}${path}`, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The AI service took too long to answer.');
    throw new Error(`Cannot reach the AI service at ${AI_URL}. Is safire-ai running?`);
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
  return request('/api/transcribe', { method: 'POST', body: form });
}

// segments = [{ segmentId, speaker, startTime, endTime, text }]
async function extractRequirements(segments, minConfidence) {
  const body = { segments };
  if (minConfidence !== undefined) body.minConfidence = minConfidence;
  return request('/api/extract-requirements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function health() {
  return request('/api/meeting/health');
}

module.exports = { transcribe, extractRequirements, health, AI_URL };
