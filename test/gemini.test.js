import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithGemini, chooseFlashLite, probeGemini } from '../gemini.mjs';

const form = { origin: 'New York, NY', budget: 800, days: 3, travelers: 2, date: '2026-11-06', budgetMode: 'strict' };
const parsed = { interests: ['food','city'], avoidInterests: [], styles: ['relaxing'], avoidStyles: [], softPreferences: ['walking'], spendingPriorities: ['food'],
  hardConstraints: { noFlights: false, noCar: true, directOnly: false, budgetIntent: 'strict' }, mentioned: { origin: 'New York', budget: 800, days: 3, travelers: 2, date: null }, ambiguities: [],
  priorityWeights: { preference: 35, budget: 35, travel: 20, experience: 10 }, explanation: 'You want a walkable food trip without renting a car.' };
const models = [{ name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-lite-tts', supportedGenerationMethods: ['generateContent'] }];

test('Gemini discovers an accessible stable Flash-Lite and validates structured analysis', async () => {
  assert.equal(chooseFlashLite(models), 'models/gemini-3.1-flash-lite');
  assert.equal(chooseFlashLite(models, 'gemini-not-present'), null);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] } : { models }), { status: 200 });
  };
  const result = await analyzeWithGemini({ text: 'Great food and walking, no rental car', form, apiKey: 'test-gemini-secret', fetchImpl });
  assert.equal(result.mode, 'gemini');
  assert.equal(result.analysis.hardConstraints.noCar, true);
  assert.equal(result.analysis.priorityWeights.budget, 35);
  assert.equal(result.conflicts.length, 0);
  assert.ok(calls.every(({ url }) => !url.includes('test-gemini-secret')));
  assert.ok(calls.every(({ init }) => init.headers['x-goog-api-key'] === 'test-gemini-secret'));
  const config = JSON.parse(calls[1].init.body).generationConfig;
  assert.equal(config.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(config.responseMimeType, undefined);
  assert.equal(config.responseSchema, undefined);
});

test('Gemini fails closed on missing key, HTTP error, unavailable model and malformed output', async () => {
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, fetchImpl: async () => { throw Error('must not call'); } }), { code: 'unavailable' });
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: 'test', fetchImpl: async () => new Response('{}', { status: 403 }) }), { code: 'upstream' });
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify({ models: [] })) }), { code: 'unavailable' });
  const invalid = async (url) => new Response(JSON.stringify(url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: '{bad json' }] } }] } : { models }));
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: 'test', fetchImpl: invalid }), { code: 'bad_output' });
});

test('Gemini diagnostics expose safe Google errors without leaking credentials', async () => {
  const forbidden = 'test-secret-never-return';
  for (const status of [401, 403, 404, 429]) {
    await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: forbidden, fetchImpl: async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: forbidden } }), { status }) }), (error) => {
      assert.equal(error.diagnostic.stage, 'models.list');
      assert.equal(error.diagnostic.httpStatus, status);
      assert.equal(error.diagnostic.apiVersion, 'v1beta');
      assert.equal(error.diagnostic.upstreamMessage, '[redacted]');
      assert.ok(!JSON.stringify({ message: error.message, diagnostic: error.diagnostic }).includes(forbidden));
      return true;
    });
  }
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: forbidden, fetchImpl: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; } }), (error) => error.code === 'timeout' && error.diagnostic.httpStatus === null);
  const failedGeneration = async (url) => new Response(url.includes(':generateContent') ? '{}' : JSON.stringify({ models }), { status: url.includes(':generateContent') ? 404 : 200 });
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: forbidden, fetchImpl: failedGeneration }), (error) => error.diagnostic.stage === 'generateContent' && error.diagnostic.model === 'gemini-3.1-flash-lite' && error.diagnostic.httpStatus === 404);
});

test('Gemini 400 preserves a bounded schema error and non-sensitive reason', async () => {
  const secret = 'private-key-for-test';
  const fetchImpl = async () => new Response(JSON.stringify({ error: {
    status: 'INVALID_ARGUMENT',
    message: `Invalid JSON payload: unknown field responseFormat; key=${secret}`,
    details: [{ reason: 'SCHEMA_VALIDATION_FAILED' }]
  } }), { status: 400 });
  await assert.rejects(analyzeWithGemini({ text: 'Food trip', form, apiKey: secret, model: 'gemini-3.5-flash-lite', fetchImpl }), (error) => {
    assert.equal(error.diagnostic.httpStatus, 400);
    assert.equal(error.diagnostic.upstreamStatus, 'INVALID_ARGUMENT');
    assert.match(error.diagnostic.upstreamMessage, /unknown field responseFormat/);
    assert.equal(error.diagnostic.upstreamReason, 'SCHEMA_VALIDATION_FAILED');
    assert.ok(!JSON.stringify(error.diagnostic).includes(secret));
    return true;
  });
});

test('simple Gemini probe omits structured output and never exposes the key', async () => {
  const secret = 'private-key-for-probe';
  const probe = await probeGemini({ apiKey: secret, fetchImpl: async (url, init) => {
    assert.ok(!url.includes(secret));
    const body = JSON.parse(init.body);
    assert.equal(body.contents[0].parts[0].text, 'Reply OK.');
    assert.equal(body.generationConfig, undefined);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 });
  } });
  assert.equal(probe.httpStatus, 200);
  assert.equal(probe.extracted, true);
  assert.ok(!JSON.stringify(probe).includes(secret));
});

test('explicit documented Flash-Lite model makes one generation request', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] }), { status: 200 }); };
  const result = await analyzeWithGemini({ text: 'Food, no car', form, apiKey: 'test', model: 'gemini-3.5-flash-lite', fetchImpl });
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /gemini-3\.5-flash-lite:generateContent$/);
});
