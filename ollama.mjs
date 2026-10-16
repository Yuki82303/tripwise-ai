import { detectConflicts, PREFERENCE_SCHEMA, PreferenceError, validateAnalysis } from './ai.mjs';

const baseUrl = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b';

export async function ollamaReady(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch { return false; }
}

export async function analyzeWithOllama({ text, form, model = DEFAULT_OLLAMA_MODEL, fetchImpl = fetch, timeoutMs = 20000 }) {
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > 500) throw new PreferenceError('bad_input', 'Enter 3–500 characters of travel preferences.');
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, stream: false, keep_alive: 0, options: { temperature: 0, num_predict: 650 }, format: PREFERENCE_SCHEMA,
        messages: [
          { role: 'system', content: 'Extract the user travel note into the supplied JSON schema. Respect negation. Separate hard limits from soft wishes. Only put dates, numbers and origins in mentioned when the note explicitly says them. The form is context, not note content. Do not recommend places, routes, prices or scores.' },
          { role: 'user', content: JSON.stringify({ note: text, form }) }
        ] })
    });
  } catch { throw new PreferenceError('upstream', 'Local AI is unavailable. Demo Rule-based Matching remains available.'); }
  if (!response.ok) throw new PreferenceError('upstream', 'Local AI could not finish. Check that the small model is installed, or use local rules.');
  let payload;
  try { payload = await response.json(); } catch { throw new PreferenceError('bad_output', 'Local AI returned unreadable data.'); }
  const content = payload?.message?.content;
  if (typeof content !== 'string' || content.length > 10000) throw new PreferenceError('bad_output', 'Local AI returned no usable data.');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new PreferenceError('bad_output', 'Local AI returned invalid JSON.'); }
  const analysis = validateAnalysis(parsed);
  return { source: 'Local AI Preference Analysis (Ollama)', analysis, conflicts: detectConflicts(analysis, form) };
}
