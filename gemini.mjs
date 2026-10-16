import { PREFERENCE_SCHEMA, validateAnalysis, detectConflicts, PreferenceError } from './ai.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
// Official pricing explicitly lists a free tier for 3.1 Flash-Lite. Keep the default allowlist narrow.
const FREE_TIER_CANDIDATES = ['models/gemini-3.5-flash-lite', 'models/gemini-3.1-flash-lite', 'models/gemini-2.5-flash-lite'];
const API_VERSION = 'v1beta';
const guidance = { 400: 'Check the request parameters and Structured JSON schema.', 401: 'Check that GEMINI_API_KEY is valid for the Gemini Developer API.', 402: 'The account requires payment; TripWise will not enable billing.', 403: 'Check API key restrictions and Gemini API access in the key project; no billing was enabled.', 404: 'The selected model or API version is unavailable to this key.', 429: 'Free-tier quota or rate limit reached; retry later.' };
export class GeminiDiagnosticError extends PreferenceError {
  constructor(code, message, { stage, model = null, httpStatus = null, upstreamStatus = null, upstreamMessage = null, upstreamReason = null, timeoutMs = 12000 } = {}) {
    super(code, message);
    this.diagnostic = { provider: 'Gemini', apiVersion: API_VERSION, model, stage, httpStatus, upstreamStatus, upstreamMessage, upstreamReason, timeoutMs };
  }
}
function safeDiagnosticText(value, apiKey) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replaceAll(apiKey, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .replace(/(?:AIza|AzaS)[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .replace(/(?:api[_-]?key|x-goog-api-key)\s*[:=]\s*\S+/gi, 'API key [redacted]')
    .replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 350) : null;
}
export async function probeGemini({ apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch, timeoutMs = 12000 }) {
  if (!apiKey) return { requested: false, httpStatus: null, validJson: false, extracted: false, failureCode: 'not_configured' };
  const selected = model.startsWith('models/') ? model : `models/${model}`;
  if (!FREE_TIER_CANDIDATES.includes(selected)) return { requested: false, httpStatus: null, validJson: false, extracted: false, failureCode: 'unsupported_model' };
  const started = performance.now();
  const result = { requested: true, model: selected.slice(7), apiVersion: API_VERSION, stage: 'generateContent.simple', httpStatus: null, validJson: false, extracted: false, elapsedMs: null, failureCode: null };
  try {
    const response = await fetchImpl(`${API}/${selected}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply OK.' }] }] }), signal: AbortSignal.timeout(timeoutMs)
    });
    result.httpStatus = response.status;
    let body;
    try { body = await response.json(); result.validJson = true; } catch { result.failureCode = 'invalid_json'; }
    if (!response.ok) {
      result.failureCode = /^[A-Z_]{2,40}$/.test(body?.error?.status || '') ? body.error.status : `http_${response.status}`;
      result.upstreamMessage = safeDiagnosticText(body?.error?.message, apiKey);
      const details = Array.isArray(body?.error?.details) ? body.error.details : [];
      result.upstreamReason = safeDiagnosticText(details.find((item) => typeof item?.reason === 'string')?.reason, apiKey);
    } else if (typeof body?.candidates?.[0]?.content?.parts?.[0]?.text === 'string') result.extracted = true;
    else result.failureCode = 'no_text_output';
  } catch (error) { result.failureCode = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network_unreachable'; }
  result.elapsedMs = Math.round(performance.now() - started);
  return result;
}
const preferenceSchema = {
  ...PREFERENCE_SCHEMA,
  properties: {
    ...PREFERENCE_SCHEMA.properties,
    priorityWeights: { type: 'object', properties: {
      preference: { type: 'integer' }, budget: { type: 'integer' }, travel: { type: 'integer' }, experience: { type: 'integer' }
    }, required: ['preference','budget','travel','experience'] },
    explanation: { type: 'string' }
  },
  required: [...PREFERENCE_SCHEMA.required, 'priorityWeights', 'explanation']
};

function safeModelName(value) {
  return typeof value === 'string' && /^models\/gemini-[a-z0-9.-]+$/.test(value);
}

export function chooseFlashLite(models, requested) {
  const eligible = (Array.isArray(models) ? models : []).filter((model) => safeModelName(model.name) && FREE_TIER_CANDIDATES.includes(model.name) && model.supportedGenerationMethods?.includes('generateContent'));
  if (requested) return eligible.find((model) => model.name === `models/${requested}` || model.name === requested)?.name || null;
  return FREE_TIER_CANDIDATES.find((name) => eligible.some((model) => model.name === name)) || null;
}

export async function analyzeWithGemini({ text, form, apiKey, model, fetchImpl = fetch, timeoutMs = 12000 }) {
  if (!apiKey) throw new PreferenceError('unavailable', 'Gemini is not configured. Using Demo Rule-based Matching.');
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > 500) throw new PreferenceError('bad_input', 'Enter 3–500 characters of travel preferences.');
  const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
  const getJson = async (url, init, stage, selectedModel = null) => {
    let response;
    try { response = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) { const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'; throw new GeminiDiagnosticError(timedOut ? 'timeout' : 'upstream', timedOut ? 'Gemini timed out. Try again later or use local matching.' : 'Gemini could not be reached. Check network access.', { stage, model: selectedModel, timeoutMs }); }
    if (!response.ok) {
      let upstreamStatus = null, upstreamMessage = null, upstreamReason = null;
      try {
        const body = await response.json();
        if (/^[A-Z_]{2,40}$/.test(body?.error?.status || '')) upstreamStatus = body.error.status;
        upstreamMessage = safeDiagnosticText(body?.error?.message, apiKey);
        const details = Array.isArray(body?.error?.details) ? body.error.details : [];
        const reason = details.find((item) => typeof item?.reason === 'string')?.reason
          || details.flatMap((item) => Array.isArray(item?.fieldViolations) ? item.fieldViolations : []).find((item) => typeof item?.description === 'string')?.description;
        upstreamReason = safeDiagnosticText(reason, apiKey);
      } catch { /* Unreadable upstream data stays absent. */ }
      throw new GeminiDiagnosticError('upstream', `Gemini HTTP ${response.status}. ${guidance[response.status] || 'Check the selected model and try again later.'}`, { stage, model: selectedModel, httpStatus: response.status, upstreamStatus, upstreamMessage, upstreamReason, timeoutMs });
    }
    try { return await response.json(); } catch { throw new GeminiDiagnosticError('bad_output', 'Gemini returned unreadable data.', { stage, model: selectedModel, httpStatus: response.status, timeoutMs }); }
  };
  // A user-selected documented free-tier model can be called directly: one analysis = one API request.
  // Without an explicit model, discover access from models.list before generation.
  const requested = model?.startsWith('models/') ? model : model ? `models/${model}` : null;
  const list = requested && FREE_TIER_CANDIDATES.includes(requested) ? null : await getJson(`${API}/models?pageSize=1000`, { method: 'GET' }, 'models.list');
  const chosen = list ? chooseFlashLite(list.models, model) : requested;
  if (!chosen) throw new GeminiDiagnosticError('unavailable', model ? 'The configured Gemini Flash-Lite model is not available to this key.' : 'No free-tier Gemini Flash-Lite model was listed for this key.', { stage: 'models.list', model: model || null, httpStatus: 200, timeoutMs });
  const payload = await getJson(`${API}/${chosen}:generateContent`, { method: 'POST', body: JSON.stringify({
    systemInstruction: { parts: [{ text: 'Extract only user-stated travel wishes and restrictions. Respect negation and strength. Form values are context, not evidence that a number was mentioned. Do not recommend destinations, invent routes, prices, reviews, or scores. Return a concise English explanation. Priority weights are suggested relative emphasis, not objective utility.' }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ note: text, formContext: form }) }] }],
    generationConfig: { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: preferenceSchema } }, temperature: 0.1, maxOutputTokens: 900 }
  }) }, 'generateContent', chosen.replace('models/', ''));
  const output = payload.candidates?.[0]?.content?.parts?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
  if (!output || output.length > 12000) throw new PreferenceError('bad_output', 'Gemini returned no usable JSON.');
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new PreferenceError('bad_output', 'Gemini returned invalid JSON.'); }
  const analysis = validateAnalysis(parsed);
  const weights = parsed.priorityWeights;
  if (!weights || Object.keys(weights).length !== 4 || Object.values(weights).some((value) => !Number.isInteger(value) || value < 0 || value > 100) || Object.values(weights).every((value) => value === 0)) throw new PreferenceError('bad_output', 'Gemini returned invalid priority weights.');
  if (typeof parsed.explanation !== 'string' || parsed.explanation.length > 200) throw new PreferenceError('bad_output', 'Gemini returned an invalid explanation.');
  return { source: 'AI-powered Preference Analysis · Gemini', mode: 'gemini', model: chosen.replace('models/', ''), analysis: { ...analysis, priorityWeights: weights, explanation: parsed.explanation.trim() }, conflicts: detectConflicts(analysis, form) };
}
