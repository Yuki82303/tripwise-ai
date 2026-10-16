// Server-only OpenAI adapter. No credential or model response is sent to the browser unfiltered.
const interests = ['beach','nature','city','food','culture','nightlife'];
const styles = ['relaxing','adventurous','romantic','quiet','less_touristy'];
const soft = ['warm_weather','walking','direct_flights'];
const spending = ['accommodation','food','experiences','transportation'];
const strings = (values) => ({ type: 'array', items: { type: 'string', enum: values } });
const nullableNumber = { type: ['number','null'] };
const nullableString = { type: ['string','null'] };

export const PREFERENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    interests: strings(interests), avoidInterests: strings(interests),
    styles: strings(styles), avoidStyles: strings(styles),
    softPreferences: strings(soft), spendingPriorities: strings(spending),
    hardConstraints: {
      type: 'object', additionalProperties: false,
      properties: { noFlights: { type: 'boolean' }, noCar: { type: 'boolean' }, directOnly: { type: 'boolean' }, budgetIntent: { type: 'string', enum: ['strict','flexible','unspecified'] } },
      required: ['noFlights','noCar','directOnly','budgetIntent']
    },
    mentioned: {
      type: 'object', additionalProperties: false,
      properties: { origin: nullableString, budget: nullableNumber, days: nullableNumber, travelers: nullableNumber, date: nullableString },
      required: ['origin','budget','days','travelers','date']
    },
    ambiguities: { type: 'array', items: { type: 'string' } }
  },
  required: ['interests','avoidInterests','styles','avoidStyles','softPreferences','spendingPriorities','hardConstraints','mentioned','ambiguities']
};

export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';
export class PreferenceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function cleanEnumArray(value, allowed, label) {
  if (!Array.isArray(value) || value.length > allowed.length || value.some((item) => !allowed.includes(item))) throw new PreferenceError('bad_output', `Invalid ${label} in AI response.`);
  return [...new Set(value)];
}
function cleanText(value, label) {
  if (value !== null && (typeof value !== 'string' || value.length > 160)) throw new PreferenceError('bad_output', `Invalid ${label} in AI response.`);
  return value === null ? null : value.trim();
}
function cleanNumber(value, label) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000)) throw new PreferenceError('bad_output', `Invalid ${label} in AI response.`);
  return value;
}

export function validateAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreferenceError('bad_output', 'AI response is not an object.');
  const hard = value.hardConstraints, mentioned = value.mentioned;
  if (!hard || typeof hard !== 'object' || !mentioned || typeof mentioned !== 'object' || Array.isArray(mentioned) || ['noFlights','noCar','directOnly'].some((key) => typeof hard[key] !== 'boolean') || !['strict','flexible','unspecified'].includes(hard.budgetIntent)) throw new PreferenceError('bad_output', 'AI constraints are invalid.');
  if (!Array.isArray(value.ambiguities) || value.ambiguities.length > 5 || value.ambiguities.some((x) => typeof x !== 'string' || x.length > 160)) throw new PreferenceError('bad_output', 'AI ambiguities are invalid.');
  return {
    interests: cleanEnumArray(value.interests, interests, 'interests'), avoidInterests: cleanEnumArray(value.avoidInterests, interests, 'avoided interests'),
    styles: cleanEnumArray(value.styles, styles, 'styles'), avoidStyles: cleanEnumArray(value.avoidStyles, styles, 'avoided styles'),
    softPreferences: cleanEnumArray(value.softPreferences, soft, 'soft preferences'), spendingPriorities: cleanEnumArray(value.spendingPriorities, spending, 'spending priorities'),
    hardConstraints: { noFlights: hard.noFlights, noCar: hard.noCar, directOnly: hard.directOnly, budgetIntent: hard.budgetIntent },
    mentioned: { origin: cleanText(mentioned.origin, 'origin'), budget: cleanNumber(mentioned.budget, 'budget'), days: cleanNumber(mentioned.days, 'days'), travelers: cleanNumber(mentioned.travelers, 'travelers'), date: cleanText(mentioned.date, 'date') },
    ambiguities: value.ambiguities.map((x) => x.trim())
  };
}

export function detectConflicts(analysis, form) {
  const conflicts = [];
  const values = analysis.mentioned;
  const names = { budget: 'group budget', days: 'trip length', travelers: 'traveler count', date: 'departure date' };
  for (const key of Object.keys(names)) {
    if (values[key] !== null && String(values[key]) !== String(form[key])) conflicts.push(`Your note mentions ${names[key]} ${values[key]}, while the form says ${form[key]}. The form value will be used.`);
  }
  if (values.origin) {
    const named = values.origin.toLowerCase().replace(/[^a-z]/g,'');
    const full = String(form.origin || '').toLowerCase().replace(/[^a-z]/g,'');
    const city = String(form.origin || '').split(',')[0].toLowerCase().replace(/[^a-z]/g,'');
    if (named !== full && named !== city) conflicts.push(`Your note mentions departure from ${values.origin}, while the form says ${form.origin}. The form value will be used.`);
  }
  if (analysis.hardConstraints.budgetIntent !== 'unspecified' && analysis.hardConstraints.budgetIntent !== (form.budgetMode === 'flexible' ? 'flexible' : 'strict')) conflicts.push(`Your note requests a ${analysis.hardConstraints.budgetIntent} budget, while the form is ${form.budgetMode === 'flexible' ? 'Flexible' : 'Strict'}. The form setting will be used.`);
  return conflicts;
}

export function makeRequest(text, form, model = DEFAULT_AI_MODEL) {
  return {
    model, store: false, max_output_tokens: 650,
    input: [
      { role: 'system', content: 'Extract travel preferences from the user note only. Respect negation, degree and priority. Separate strong prohibitions from soft wishes: prefer direct flights is soft; no layovers is hard. Only extract numbers or dates explicitly stated in the note; use null otherwise. Do not recommend destinations, estimate fares, assert routes, or calculate scores. Do not invent facts. Return concise ambiguities when wording is unresolved.' },
      { role: 'user', content: JSON.stringify({ note: text, formContext: { origin: form.origin, budget: form.budget, date: form.date, days: form.days, travelers: form.travelers, budgetMode: form.budgetMode }, instruction: 'Form values are context for detecting contradictions, not evidence that a detail was mentioned in the note.' }) }
    ],
    text: { format: { type: 'json_schema', name: 'tripwise_preferences', strict: true, schema: PREFERENCE_SCHEMA } }
  };
}

export async function analyzeWithOpenAI({ text, form, apiKey, model = DEFAULT_AI_MODEL, fetchImpl = fetch, timeoutMs = 12000 }) {
  if (!apiKey) throw new PreferenceError('unavailable', 'AI mode is not configured on this server.');
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > 500) throw new PreferenceError('bad_input', 'Enter 3–500 characters of travel preferences.');
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest(text, form, model)), signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new PreferenceError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'upstream', 'AI analysis is unavailable right now. Your local demo remains available.');
  }
  if (!response.ok) throw new PreferenceError('upstream', 'AI analysis could not complete. Your local demo remains available.');
  let payload;
  try { payload = await response.json(); } catch { throw new PreferenceError('bad_output', 'AI returned unreadable data.'); }
  if (payload.status !== 'completed') throw new PreferenceError('incomplete', 'AI analysis was incomplete. Try again or use local matching.');
  if (!Array.isArray(payload.output)) throw new PreferenceError('bad_output', 'AI returned malformed output.');
  const content = payload.output.filter((item) => item?.type === 'message').flatMap((item) => Array.isArray(item.content) ? item.content : []);
  if (content.some((item) => item.type === 'refusal')) throw new PreferenceError('refusal', 'AI could not analyze this note. Use local matching or revise it.');
  const output = content.find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text;
  if (!output || output.length > 10000) throw new PreferenceError('bad_output', 'AI returned no usable structured data.');
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new PreferenceError('bad_output', 'AI returned invalid JSON.'); }
  const analysis = validateAnalysis(parsed);
  return { source: 'AI-powered Preference Analysis', analysis, conflicts: detectConflicts(analysis, form) };
}
