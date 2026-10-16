// Explicit, one-shot local diagnostic. Never print keys, headers or raw bodies.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeWithGemini, probeGemini } from '../gemini.mjs';
import { SerpClient, parseHotels, selectOutboundToken } from '../serpapi.mjs';

if (process.env.TRIPWISE_LIVE_DIAG !== 'YES') {
  console.log('No requests sent. Set TRIPWISE_LIVE_DIAG=YES to run one Gemini, one Flights and one Hotels diagnostic.');
  process.exit(0);
}

const allowed = new Set(['GEMINI_API_KEY','GEMINI_MODEL','SERPAPI_API_KEY','SERPAPI_DAILY_LIMIT']);
const env = {};
try {
  for (const line of (await readFile(resolve('.env'), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match && allowed.has(match[1])) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
} catch { /* Keyless mode reports skipped. */ }
for (const key of allowed) if (process.env[key]) env[key] = process.env[key];

const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const end = new Date(Date.parse(`${date}T12:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
const output = [];
const modelValid = !env.GEMINI_MODEL || /^(?:models\/)?gemini-[a-z0-9.-]{2,50}$/.test(env.GEMINI_MODEL);
const model = modelValid ? (env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : 'invalid-configured-model';
const simpleOnly = process.env.TRIPWISE_DIAG_GEMINI_SIMPLE === 'YES';
const gemini = { service: 'Gemini', model, requested: false, httpStatus: null, validJson: false, extracted: false, elapsedMs: null, failureCode: null };
if (!modelValid) gemini.failureCode = 'invalid_model_name';
else if (simpleOnly) Object.assign(gemini, await probeGemini({ apiKey: env.GEMINI_API_KEY, model }));
else if (env.GEMINI_API_KEY) {
  const started = performance.now();
  try {
    await analyzeWithGemini({ text: 'Food, no car.', form: { origin: 'New York, NY', budget: 800, date, days: 3, travelers: 2, budgetMode: 'strict' }, apiKey: env.GEMINI_API_KEY, model,
      fetchImpl: async (url, init) => {
        gemini.requested = true;
        const response = await fetch(url, init);
        gemini.httpStatus = response.status;
        try { await response.clone().json(); gemini.validJson = true; } catch { /* Unreadable JSON. */ }
        return response;
      } });
    gemini.extracted = true;
  } catch (error) {
    gemini.failureCode = error?.diagnostic?.upstreamStatus || error?.code || 'unknown';
    gemini.upstreamMessage = error?.diagnostic?.upstreamMessage || null;
    gemini.upstreamReason = error?.diagnostic?.upstreamReason || null;
  }
  gemini.elapsedMs = Math.round(performance.now() - started);
} else gemini.failureCode = 'not_configured';
output.push(gemini);

if (simpleOnly || process.env.TRIPWISE_DIAG_GEMINI_ONLY === 'YES') {
  output.push({ service: 'SerpApi', requested: false, failureCode: 'skipped_by_gemini_only_mode' });
} else if (env.SERPAPI_API_KEY) {
  let active = null;
  const client = new SerpClient({ apiKey: env.SERPAPI_API_KEY, root: resolve('.'), dailyLimit: env.SERPAPI_DAILY_LIMIT || 8,
    fetchImpl: async (url, init) => {
      const method = JSON.parse(init.body).method;
      if (method === 'tools/call') active.requested = true;
      const response = await fetch(url, init);
      if (method === 'tools/call') {
        active.httpStatus = response.status;
        try {
          const body = await response.clone().text();
          const sample = body.trim().startsWith('data:') ? body.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim() : body;
          JSON.parse(sample);
          active.validJson = true;
        } catch { /* Unreadable tool result. */ }
      }
      return response;
    } });
  const searches = [
    { service: 'Google Flights via SerpApi', params: { engine: 'google_flights', departure_id: 'JFK', arrival_id: 'ORD', outbound_date: date, return_date: end, type: '1', adults: 2, currency: 'USD', travel_class: '1', hl: 'en', gl: 'us' } },
    { service: 'Google Hotels via SerpApi', params: { engine: 'google_hotels', q: 'Chicago, Illinois hotels', check_in_date: date, check_out_date: end, adults: 2, currency: 'USD', hl: 'en', gl: 'us' } }
  ];
  for (const search of searches) {
    active = { service: search.service, requested: false, httpStatus: null, validJson: false, extracted: false, elapsedMs: null, failureCode: null };
    const started = performance.now();
    try {
      const result = await client.search(search.params);
      active.validJson = Boolean(result.data && typeof result.data === 'object');
      active.extracted = search.params.engine === 'google_flights'
        ? Boolean(selectOutboundToken(result.data, { from: 'JFK', to: 'ORD', depart: date }))
        : Boolean(parseHotels(result.data, { checkIn: date, checkOut: end, travelers: 2, rooms: 1, nights: 2, checkedAt: result.checkedAt, freshness: result.freshness }).totalStay);
      if (!active.extracted) active.failureCode = search.params.engine === 'google_flights' ? 'no_matching_outbound_token_or_itinerary' : 'no_matching_full_stay_total';
    } catch (error) { active.failureCode = error?.code || 'unknown'; }
    active.elapsedMs = Math.round(performance.now() - started);
    output.push(active);
  }
} else output.push({ service: 'Google Flights via SerpApi', requested: false, failureCode: 'not_configured' }, { service: 'Google Hotels via SerpApi', requested: false, failureCode: 'not_configured' });

console.log(JSON.stringify({ date, returnOrCheckOut: end, results: output, note: 'Gemini-only mode skips every SerpApi request. Otherwise Flights checks one outbound result only; a round-trip fare needs a second search and remains unverified here.' }, null, 2));
