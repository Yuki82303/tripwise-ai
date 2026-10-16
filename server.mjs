import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { analyzeWithOpenAI, DEFAULT_AI_MODEL, PreferenceError } from './ai.mjs';
import { readCommunityQuotes } from './community.mjs';
import { getNwsForecast } from './weather.mjs';
import { analyzeWithOllama, DEFAULT_OLLAMA_MODEL, ollamaReady } from './ollama.mjs';
import { analyzeWithGemini, DEFAULT_GEMINI_MODEL } from './gemini.mjs';
import { SerpClient, LiveError } from './serpapi.mjs';
import { checkDestination, searchDiscussions, tripDates } from './travel-live.mjs';
import { DESTINATIONS, ORIGINS } from './src/data.js';

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };

export function isAllowedOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = req.headers?.host;
    if (host) return parsed.host.toLowerCase() === host.toLowerCase();
    // A missing Host header occurs in local unit-test requests, not normal browsers.
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  } catch { return false; }
}

export function createHandler(root = resolve('.'), options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const startedAt = new Date(now()).toISOString();
  const recentByIp = new Map();
  const recentGlobal = [];
  const cache = new Map();
  const pending = new Map();
  const weatherCache = new Map();
  const serp = new SerpClient({ apiKey: env.SERPAPI_API_KEY?.trim(), fetchImpl, root: options.usageRoot || resolve('.'), now, dailyLimit: env.SERPAPI_DAILY_LIMIT || 8 });
  let geminiVerified = false;
  let geminiDiagnostic = null;
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const provider = () => env.GEMINI_API_KEY?.trim() ? 'gemini' : env.TRIPWISE_OLLAMA === '1' ? 'ollama' : env.OPENAI_API_KEY?.trim() ? 'openai' : null;
  const configured = () => Boolean(provider());
  const handleAnalysis = async (req, res) => {
    if (!configured()) { json(res, 503, { error: 'unavailable', message: 'AI mode is not configured. Demo Rule-based Matching is available.' }); return; }
    if (!isAllowedOrigin(req)) { json(res, 403, { error: 'origin', message: 'Use this endpoint from the TripWise site.' }); return; }
    if (!String(req.headers?.['content-type'] || '').startsWith('application/json')) { json(res, 415, { error: 'content_type', message: 'Send JSON.' }); return; }
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 3500) { json(res, 413, { error: 'too_large', message: 'Preference request is too long.' }); return; }
      }
    } catch { json(res, 400, { error: 'bad_input', message: 'Could not read request.' }); return; }
    let body;
    try { body = JSON.parse(raw); } catch { json(res, 400, { error: 'bad_input', message: 'Invalid JSON.' }); return; }
    const text = body?.text;
    const form = body?.form;
    if (typeof text !== 'string' || text.trim().length < 3 || text.length > 500 || !form || typeof form !== 'object' || !['strict','flexible'].includes(form.budgetMode) || typeof form.origin !== 'string' || form.origin.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !(Number(form.budget) >= 100 && Number(form.budget) <= 30000) || !(Number.isInteger(Number(form.days)) && Number(form.days) >= 2 && Number(form.days) <= 7) || !(Number.isInteger(Number(form.travelers)) && Number(form.travelers) >= 1 && Number(form.travelers) <= 4)) {
      json(res, 400, { error: 'bad_input', message: 'Check the note and travel form before AI analysis.' }); return;
    }
    const safeForm = { origin: form.origin.slice(0, 80), budget: Number(form.budget), date: form.date, days: Number(form.days), travelers: Number(form.travelers), budgetMode: form.budgetMode };
    const selectedProvider = provider();
    const model = selectedProvider === 'gemini' ? (env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) : selectedProvider === 'ollama' ? (env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL) : (env.OPENAI_MODEL || DEFAULT_AI_MODEL);
    const key = createHash('sha256').update(JSON.stringify({ text, form: safeForm, model, provider: selectedProvider })).digest('hex');
    const cached = cache.get(key);
    if (cached && cached.until > now()) { json(res, 200, cached.value); return; }
    const ip = req.socket?.remoteAddress || 'local';
    const interval = 10 * 60 * 1000;
    const ipTimes = (recentByIp.get(ip) || []).filter((time) => time > now() - interval);
    const globalTimes = recentGlobal.filter((time) => time > now() - 60 * 60 * 1000);
    if (ipTimes.length >= 6 || globalTimes.length >= 30) { json(res, 429, { error: 'rate_limit', message: 'AI request limit reached. Wait a while or use local matching.' }); return; }
    ipTimes.push(now()); recentByIp.set(ip, ipTimes);
    recentGlobal.length = 0; recentGlobal.push(...globalTimes, now());
    try {
      let task = pending.get(key);
      if (!task) {
        task = selectedProvider === 'gemini'
          ? analyzeWithGemini({ text, form: safeForm, apiKey: env.GEMINI_API_KEY, model, fetchImpl })
          : selectedProvider === 'ollama'
            ? analyzeWithOllama({ text, form: safeForm, model, fetchImpl })
            : analyzeWithOpenAI({ text, form: safeForm, apiKey: env.OPENAI_API_KEY, model, fetchImpl });
        pending.set(key, task);
      }
      const value = await task;
      if (selectedProvider === 'gemini') { geminiVerified = true; geminiDiagnostic = { provider: 'Gemini', apiVersion: 'v1beta', model: value.model, stage: 'generateContent', httpStatus: 200 }; }
      cache.set(key, { value, until: now() + interval });
      json(res, 200, value);
    } catch (error) {
      const known = error instanceof PreferenceError;
      if (selectedProvider === 'gemini') geminiDiagnostic = error?.diagnostic || { provider: 'Gemini', apiVersion: 'v1beta', model: env.GEMINI_MODEL || null, stage: 'validation', httpStatus: null };
      json(res, known && error.code === 'bad_input' ? 400 : known && error.code === 'timeout' ? 504 : 502, { error: known ? error.code : 'upstream', message: known ? error.message : 'AI analysis failed. Local matching remains available.', ...(selectedProvider === 'gemini' ? { diagnostic: geminiDiagnostic } : {}) });
    } finally { pending.delete(key); }
  };
  const localPost = async (req, res) => {
    if (!isAllowedOrigin(req)) { json(res, 403, { error: 'origin', message: 'Use this endpoint from the TripWise site.' }); return null; }
    if (!String(req.headers?.['content-type'] || '').startsWith('application/json')) { json(res, 415, { error: 'content_type', message: 'Send JSON.' }); return null; }
    let raw = '';
    try { for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 2500) { json(res, 413, { error: 'too_large', message: 'Request too large.' }); return null; } } return JSON.parse(raw); }
    catch { json(res, 400, { error: 'bad_input', message: 'Invalid JSON request.' }); return null; }
  };
  return async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api/community' && req.method === 'GET') {
        const destination = new URL(req.url, 'http://localhost').searchParams.get('destination') || '';
        json(res, 200, { destination, quotes: await readCommunityQuotes(root, destination), source: 'Curated community voice · manual import' });
        return;
      }
      if (pathname === '/api/weather' && req.method === 'GET') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const destinationId = params.get('destination') || '';
        const date = params.get('date') || '';
        const key = `${destinationId}:${date}`;
        const cached = weatherCache.get(key);
        if (cached && cached.until > now()) { json(res, 200, cached.value); return; }
        const value = await getNwsForecast({ destinationId, date, fetchImpl, now: new Date(now()) });
        for (const [savedKey, record] of weatherCache) if (record.until <= now()) weatherCache.delete(savedKey);
        if (weatherCache.size >= 200) weatherCache.delete(weatherCache.keys().next().value);
        weatherCache.set(key, { value, until: now() + (value.available ? 30 * 60 * 1000 : 5 * 60 * 1000) });
        json(res, 200, value);
        return;
      }
      if (pathname === '/api/preferences/status' && req.method === 'GET') {
        const active = provider();
        const available = active === 'openai' || active === 'gemini' || (active === 'ollama' && await ollamaReady(fetchImpl));
        json(res, 200, available ? { available: true, mode: active === 'ollama' ? 'local-ollama' : active === 'gemini' ? 'gemini-configured' : 'optional-ai' } : { available: false, mode: 'demo-only' });
        return;
      }
      if (pathname === '/api/preferences/analyze' && req.method === 'POST') { await handleAnalysis(req, res); return; }
      if (pathname === '/api/data/status' && req.method === 'GET') {
        const usage = await serp.usage();
        json(res, 200, { release: 'portfolio-final-2026-10-16', startedAt, gemini: { configured: Boolean(env.GEMINI_API_KEY?.trim()), connectionVerified: geminiVerified, diagnostic: geminiDiagnostic, note: geminiVerified ? 'A Gemini analysis succeeded in this server session.' : 'Configuration only; click Analyze with AI to test access.' }, serpapi: { configured: Boolean(env.SERPAPI_API_KEY?.trim()), connectionVerified: Boolean(serp.connectionVerified), localQueriesToday: usage.count, localDailyLimit: serp.dailyLimit, note: 'Local request count, not the official SerpApi account balance.' } });
        return;
      }
      if (pathname === '/api/live/prices' && req.method === 'POST') {
        if (!env.SERPAPI_API_KEY?.trim()) { json(res, 503, { error: 'unavailable', message: 'SerpApi is not configured. Live prices are unavailable.' }); return; }
        const body = await localPost(req, res); if (!body) return;
        const { originId, destinationIds, date, days, travelers, constraints = {}, refresh = false } = body;
        try {
          tripDates(date, days);
          const offset = Date.parse(`${date}T00:00:00Z`) - Date.parse(new Date(now()).toISOString().slice(0, 10) + 'T00:00:00Z');
          if (offset < 0 || offset > 366 * 86400000) throw new LiveError('bad_input', 'Choose a date within the next 12 months for live search.');
          if (!ORIGINS.some((item) => item.id === originId) || !Array.isArray(destinationIds) || destinationIds.length < 1 || destinationIds.length > 3 || new Set(destinationIds).size !== destinationIds.length || destinationIds.some((id) => !DESTINATIONS.some((item) => item.id === id)) || !Number.isInteger(travelers) || travelers < 1 || travelers > 4 || typeof constraints.noFlights !== 'boolean' || typeof constraints.directOnly !== 'boolean' || typeof refresh !== 'boolean') throw new LiveError('bad_input', 'Check travel inputs before live search.');
          const results = [];
          for (const destinationId of destinationIds) {
            const destination = DESTINATIONS.find((item) => item.id === destinationId);
            results.push(await checkDestination(serp, { originId, destinationId, date, days, travelers, noFlights: constraints.noFlights, directOnly: constraints.directOnly, modeledOther: destination.daily * travelers * days, refresh }));
            if (results.at(-1).errors.some((code) => code === 'daily_limit' || code === 'provider_limit')) break;
          }
          const usage = await serp.usage();
          const limitReason = results.some((item) => item.errors.includes('provider_limit')) ? 'provider_limit' : results.some((item) => item.errors.includes('daily_limit')) ? 'local_daily_limit' : null;
          json(res, 200, { results, limitReached: Boolean(limitReason), limitReason, localQueriesToday: usage.count, localDailyLimit: serp.dailyLimit, note: 'Count is local safety usage, not official remaining SerpApi credits.' });
        } catch (error) { json(res, error.code === 'bad_input' ? 400 : ['daily_limit','provider_limit'].includes(error.code) ? 429 : 502, { error: error.code || 'upstream', message: error.message || 'Live pricing unavailable.' }); }
        return;
      }
      if (pathname === '/api/live/discussions' && req.method === 'POST') {
        if (!env.SERPAPI_API_KEY?.trim()) { json(res, 503, { error: 'unavailable', message: 'SerpApi is not configured. Community search is unavailable.' }); return; }
        const body = await localPost(req, res); if (!body) return;
        if (typeof body.destinationId !== 'string' || typeof body.refresh !== 'boolean' || !DESTINATIONS.some((item) => item.id === body.destinationId)) { json(res, 400, { error: 'bad_input', message: 'Choose one supported destination.' }); return; }
        try { json(res, 200, await searchDiscussions(serp, body.destinationId, body.refresh)); }
        catch (error) { json(res, ['daily_limit','provider_limit'].includes(error.code) ? 429 : 502, { error: error.code || 'upstream', message: error.message || 'Community search unavailable.' }); }
        return;
      }
      if (pathname.startsWith('/api/')) { json(res, 404, { error: 'not_found', message: 'Unknown API route.' }); return; }
      if (req.method && req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('Method not allowed'); return; }
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      // Serve only app files, never a future .env.local or other project file.
      if (!['index.html', 'styles.css', 'styles/scrapbook.css'].includes(relative) && !/^src\/[a-z0-9-]+\.js$/i.test(relative) && !/^assets\/destinations\/[a-z0-9-]+\.jpg$/i.test(relative)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const extension = relative.slice(relative.lastIndexOf('.'));
      const body = await readFile(resolve(root, relative));
      res.writeHead(200, { 'Content-Type': extension === '.jpg' ? mime[extension] : `${mime[extension]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Node 18 compatible, dependency-free .env loading. Only named keys are accepted; values are never logged.
  try {
    const dotenv = await readFile(resolve('.env'), 'utf8');
    for (const line of dotenv.split(/\r?\n/)) {
      const match = line.match(/^\s*(GEMINI_API_KEY|GEMINI_MODEL|SERPAPI_API_KEY|SERPAPI_DAILY_LIMIT|OPENAI_API_KEY|OPENAI_MODEL|TRIPWISE_OLLAMA|OLLAMA_MODEL)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
    }
  } catch { /* .env is optional. */ }
  const root = resolve(process.argv[2] === 'dist' ? 'dist' : '.');
  const port = Number(process.env.PORT || 4173);
  const server = createServer(createHandler(root));
  server.on('error', (error) => {
    console.error(`TripWise could not start on port ${port} (${error.code || 'unknown error'}). Check host and port permissions or whether another server is using the port.`);
    process.exitCode = 1;
  });
  // Render's proxy connects to the service interface, not to its loopback address.
  server.listen(port, '0.0.0.0', () => console.log(`TripWise AI is ready at http://localhost:${port}`));
}
