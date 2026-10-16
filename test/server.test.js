import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHandler, isAllowedOrigin } from '../server.mjs';

test('deployed HTTPS site can use its own API while another origin cannot', () => {
  assert.equal(isAllowedOrigin({ headers: { host: 'tripwise.onrender.com', origin: 'https://tripwise.onrender.com' } }), true);
  assert.equal(isAllowedOrigin({ headers: { host: 'tripwise.onrender.com', origin: 'https://other.example' } }), false);
  assert.equal(isAllowedOrigin({ headers: { host: 'localhost:4173', origin: 'http://localhost:4173' } }), true);
});

async function request(path) {
  const response = { status: 200, headers: {}, body: null,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; return this; }
  };
  await createHandler(resolve('.'))({ url: path }, response);
  return response;
}

async function apiRequest(handler, path, method = 'GET', payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const response = { status: 200, headers: {}, body: null,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(value) { this.body = value; return this; }
  };
  const req = { url: path, method, headers: method === 'POST' ? { 'content-type': 'application/json', origin: 'http://localhost:4173' } : {}, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
  await handler(req, response);
  return { status: response.status, body: JSON.parse(response.body) };
}

test('local handler serves the actual app and JavaScript modules', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /TripWise AI/);
  const module = await request('/src/app.js');
  assert.equal(module.status, 200);
  assert.match(module.headers['Content-Type'], /text\/javascript/);
  const scrapbook = await request('/styles/scrapbook.css');
  assert.equal(scrapbook.status, 200);
  assert.match(scrapbook.body.toString(), /Souvenir-book treatment/);
});

test('local handler refuses project files and path traversal', async () => {
  assert.equal((await request('/README.md')).status, 404);
  assert.equal((await request('/.env.local')).status, 404);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/.env.example')).status, 404);
  assert.equal((await request('/ai.mjs')).status, 404);
  assert.equal((await request('/%2e%2e/server.mjs')).status, 404);
  assert.equal((await request('/assets/destinations/../.env.local')).status, 404);
  assert.equal((await request('/assets/destinations/unverified.png')).status, 404);
});

test('local handler serves a downloaded destination JPEG with image MIME type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripwise-photo-'));
  try {
    await mkdir(join(root, 'assets', 'destinations'), { recursive: true });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await writeFile(join(root, 'assets', 'destinations', 'philadelphia.jpg'), bytes);
    const response = { status: 200, headers: {}, body: null,
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
      end(body) { this.body = body; return this; }
    };
    await createHandler(root)({ url: '/assets/destinations/philadelphia.jpg' }, response);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'image/jpeg');
    assert.deepEqual(response.body, bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AI status is disabled without key and POST cannot call an upstream service', async () => {
  let calls = 0;
  const handler = createHandler(resolve('.'), { env: {}, fetchImpl: async () => { calls++; throw Error('should not run'); } });
  assert.deepEqual((await apiRequest(handler, '/api/preferences/status')).body, { available: false, mode: 'demo-only' });
  const result = await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'quiet trip', form: {} });
  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});

test('community endpoint returns an honest empty set and optional Ollama reports availability', async () => {
  const community = await apiRequest(createHandler(resolve('.'), { env: {} }), '/api/community?destination=philadelphia');
  assert.equal(community.status, 200);
  assert.deepEqual(community.body.quotes, []);
  const local = createHandler(resolve('.'), { env: { TRIPWISE_OLLAMA: '1' }, fetchImpl: async (url) => ({ ok: url.endsWith('/api/tags') }) });
  assert.deepEqual((await apiRequest(local, '/api/preferences/status')).body, { available: true, mode: 'local-ollama' });
  const absent = createHandler(resolve('.'), { env: { TRIPWISE_OLLAMA: '1' }, fetchImpl: async () => { throw Error('offline'); } });
  assert.deepEqual((await apiRequest(absent, '/api/preferences/status')).body, { available: false, mode: 'demo-only' });
});

test('AI endpoint caches identical requests, limits calls, and never returns a key', async () => {
  let calls = 0;
  const valid = { interests: ['food'], avoidInterests: [], styles: [], avoidStyles: [], softPreferences: [], spendingPriorities: ['food'],
    hardConstraints: { noFlights: false, noCar: false, directOnly: false, budgetIntent: 'unspecified' },
    mentioned: { origin: null, budget: null, days: null, travelers: null, date: null }, ambiguities: [] };
  const fetchImpl = async () => { calls++; return { ok: true, async json() { return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(valid) }] }] }; } }; };
  const handler = createHandler(resolve('.'), { env: { OPENAI_API_KEY: 'server-only-test' }, fetchImpl, now: () => 1000000 });
  const form = { origin: 'New York, NY', budget: 1200, date: '2026-11-06', days: 3, travelers: 2, budgetMode: 'strict' };
  const first = await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'Great food', form });
  assert.equal(first.status, 200);
  assert.equal(first.body.source, 'AI-powered Preference Analysis');
  assert.ok(!JSON.stringify(first.body).includes('server-only-test'));
  assert.equal((await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'Great food', form })).status, 200);
  assert.equal(calls, 1);
  for (let i = 0; i < 5; i++) assert.equal((await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: `Great food ${i}`, form })).status, 200);
  assert.equal((await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'One more unique note', form })).status, 429);
  assert.equal(calls, 6);
});

test('Phase 3 endpoints expose configuration flags, keep keys private and refuse live requests without a key', async () => {
  const noKey = createHandler(resolve('.'), { env: {}, fetchImpl: async () => { throw Error('must not call'); } });
  const status = await apiRequest(noKey, '/api/data/status');
  assert.equal(status.body.gemini.configured, false);
  assert.equal(status.body.release, 'portfolio-final-2026-10-16');
  assert.equal(status.body.serpapi.configured, false);
  assert.equal((await apiRequest(noKey, '/api/live/prices', 'POST', {})).status, 503);
  assert.equal((await apiRequest(noKey, '/api/live/discussions', 'POST', {})).status, 503);
});

test('Gemini HTTP failure is exposed as a sanitized server diagnostic and local fallback stays available', async () => {
  const secret = 'private-gemini-test-secret';
  const handler = createHandler(resolve('.'), { env: { GEMINI_API_KEY: secret }, fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: secret } }), { status: 403 }) });
  const form = { origin: 'New York, NY', budget: 1200, date: '2026-11-06', days: 3, travelers: 2, budgetMode: 'strict' };
  const result = await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'Quiet food trip', form });
  assert.equal(result.status, 502);
  assert.equal(result.body.diagnostic.httpStatus, 403);
  assert.equal(result.body.diagnostic.stage, 'generateContent');
  assert.equal(result.body.diagnostic.model, 'gemini-3.5-flash-lite');
  assert.ok(!JSON.stringify(result.body).includes(secret));
  const status = await apiRequest(handler, '/api/data/status');
  assert.equal(status.body.gemini.configured, true);
  assert.equal(status.body.gemini.connectionVerified, false);
  assert.equal(status.body.gemini.diagnostic.httpStatus, 403);
});

test('configured Gemini makes one structured request and returns usable New York group preferences', async () => {
  let requests = 0;
  const preference = { interests: ['food','city'], avoidInterests: [], styles: ['relaxing'], avoidStyles: [], softPreferences: ['walking'], spendingPriorities: ['food'],
    hardConstraints: { noFlights: false, noCar: true, directOnly: false, budgetIntent: 'unspecified' },
    mentioned: { origin: null, budget: null, days: null, travelers: null, date: null }, ambiguities: [],
    priorityWeights: { preference: 40, budget: 30, travel: 20, experience: 10 }, explanation: 'A walkable food trip without a rental car.' };
  const handler = createHandler(resolve('.'), { env: { GEMINI_API_KEY: 'server-only-test-key' }, fetchImpl: async (url, init) => {
    requests++;
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(JSON.parse(init.body).generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(preference) }] } }] }), { status: 200 });
  } });
  const form = { origin: 'New York, NY', budget: 1200, date: '2026-11-06', days: 3, travelers: 2, budgetMode: 'strict' };
  const result = await apiRequest(handler, '/api/preferences/analyze', 'POST', { text: 'Great food and city energy, no rental car', form });
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'gemini');
  assert.deepEqual(result.body.analysis.interests, ['food','city']);
  assert.equal(result.body.analysis.hardConstraints.noCar, true);
  assert.equal(result.body.analysis.priorityWeights.preference, 40);
  assert.equal(requests, 1);
  assert.ok(!JSON.stringify(result.body).includes('server-only-test-key'));
});

test('Phase 3 price HTTP route uses mocked MCP payloads and returns no secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripwise-live-api-'));
  await mkdir(join(root, 'data'));
  const fixtures = Object.fromEntries(await Promise.all(['flights-outbound.json','flights-return.json','hotels.json','discussions.json'].map(async (name) => [name, JSON.parse(await (await import('node:fs/promises')).readFile(join(resolve('test/fixtures'), name), 'utf8'))])));
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    const p = request.params?.arguments?.params;
    const result = p ? { structuredContent: { result: JSON.stringify(p.engine === 'google' ? fixtures['discussions.json'] : p.engine === 'google_hotels' ? fixtures['hotels.json'] : p.departure_token ? fixtures['flights-return.json'] : fixtures['flights-outbound.json']) } } : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const handler = createHandler(resolve('.'), { env: { SERPAPI_API_KEY: 'private-test-secret', SERPAPI_DAILY_LIMIT: '8' }, usageRoot: root, fetchImpl, now: () => Date.parse('2026-10-16T12:00:00Z') });
    const result = await apiRequest(handler, '/api/live/prices', 'POST', { originId: 'new-york', destinationIds: ['chicago'], date: '2026-11-06', days: 3, travelers: 2, constraints: { noFlights: false, directOnly: false }, refresh: false });
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].flight.groupFare, null);
    assert.equal(result.body.results[0].flight.groupFareEstimate, 820);
    assert.equal(result.body.results[0].hotel.totalStay, 286);
    assert.equal(result.body.localQueriesToday, 3);
    assert.ok(!JSON.stringify(result.body).includes('private-test-secret'));
    const voices = await apiRequest(handler, '/api/live/discussions', 'POST', { destinationId: 'chicago', refresh: false });
    assert.equal(voices.status, 200);
    assert.equal(voices.body.discussions[0].url, 'https://www.reddit.com/r/travel/comments/example/chicago_weekend/');
    assert.equal(voices.body.engagementVerified, false);
    const status = await apiRequest(handler, '/api/data/status');
    assert.equal(status.body.serpapi.connectionVerified, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
