// Needs Node 18+ (global fetch). Check with:  node -v
//
// ONE Python service (safire-ai, port 8001) does both jobs:
//   POST /proposal/generate                    -> fine-tuned T5 model
//   POST /api/freelancer/extract-highlights    -> Groq (resume / GitHub highlights)
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';
const EXTRACT_URL = process.env.AI_EXTRACT_URL || AI_URL;

// Optional API key. Leave AI_API_KEY empty in .env for local development.
// If you set it, it must equal AI_SERVICE_KEY in safire-ai/.env
function aiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.AI_API_KEY) {
    h[process.env.AI_API_KEY_HEADER || 'X-API-Key'] = process.env.AI_API_KEY;
  }
  return h;
}

// T5 on a laptop CPU can take up to ~1-2 minutes, so the timeout is generous.
async function callAI(url, body, { timeoutMs = 180000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: aiHeaders(),
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('AI service rejected the API key. Check AI_API_KEY (Node .env) and AI_SERVICE_KEY (safire-ai .env)');
      }
      const detail = await res.text();
      throw new Error(`AI service error ${res.status}: ${detail.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI service timed out');
    if (err.cause?.code === 'ECONNREFUSED') throw new Error('AI service is not running');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function generateProposal({ jobTitle, jobDescription, profileHighlights, tone, skills, name }) {
  const data = await callAI(`${AI_URL}/proposal/generate`, {
    job_title: jobTitle || '',
    job_description: jobDescription,
    highlights: profileHighlights || '',
    tone,
    skills: skills || [],
    freelancer_name: name || '',
  });

  const text = data.proposal || data.generated_proposal || data.text;
  if (!text) throw new Error('AI service returned no proposal text');

  const isTemplate =
    data.is_template === true || data.template === true || data.source === 'template';

  return { text, source: isTemplate ? 'template' : 'model' };
}

// source: 'resume' | 'github', text: raw resume text or GitHub summary
async function extractHighlightsAI(source, text) {
  const data = await callAI(
    `${EXTRACT_URL}/api/freelancer/extract-highlights`,
    { source, text },
    { timeoutMs: 60000 }
  );
  if (!data.highlights) throw new Error('AI service returned no highlights');
  return data.highlights;
}

module.exports = { generateProposal, extractHighlightsAI };