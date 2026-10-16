import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithOpenAI, detectConflicts, makeRequest, PreferenceError, validateAnalysis } from '../ai.mjs';
import { recommend, resolveOrigin } from '../src/engine.js';

const form = { origin: 'New York, NY', budget: 1200, date: '2026-11-06', days: 3, travelers: 2, budgetMode: 'strict' };
const analysis = {
  interests: ['food','culture'], avoidInterests: ['nightlife'], styles: ['quiet','less_touristy'], avoidStyles: [],
  softPreferences: ['warm_weather','walking'], spendingPriorities: ['experiences','food'],
  hardConstraints: { noFlights: true, noCar: true, directOnly: false, budgetIntent: 'strict' },
  mentioned: { origin: null, budget: 900, days: null, travelers: null, date: null }, ambiguities: ['Date mentioned only as fall.']
};
const apiResponse = (value = analysis) => ({ ok: true, async json() { return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }; } });

test('complex note and negation are sent intact to strict Structured Outputs without asking for scores', () => {
  const note = 'I do not want nightlife. I love quiet culture and food, no flights, no rental car; spend more on experiences than hotels.';
  const payload = makeRequest(note, form);
  assert.equal(payload.model, 'gpt-4.1-mini');
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.strict, true);
  assert.equal(JSON.parse(payload.input[1].content).note, note);
  assert.match(payload.input[0].content, /negation/);
  assert.match(payload.input[0].content, /Do not recommend destinations/);
});

test('mocked AI extraction preserves separate avoid, hard, soft, and spending data; form wins conflicts', async () => {
  let calls = 0;
  const result = await analyzeWithOpenAI({ text: 'Quiet food and culture, not nightlife; no flights; spend on experiences, budget $900.', form, apiKey: 'test-only', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer test-only');
    return apiResponse();
  } });
  assert.equal(calls, 1);
  assert.equal(result.source, 'AI-powered Preference Analysis');
  assert.deepEqual(result.analysis.avoidInterests, ['nightlife']);
  assert.equal(result.analysis.hardConstraints.noFlights, true);
  assert.deepEqual(result.analysis.spendingPriorities, ['experiences','food']);
  assert.ok(result.conflicts.some((x) => x.includes('$') || x.includes('900')));
  const outcome = recommend({ origin: resolveOrigin(form.origin), date: new Date(`${form.date}T12:00:00Z`), days: form.days, travelers: form.travelers, budget: form.budget,
    selected: result.analysis.interests, styles: result.analysis.styles, avoidInterests: result.analysis.avoidInterests,
    softPreferences: result.analysis.softPreferences, constraints: result.analysis.hardConstraints });
  assert.ok(outcome.results.every((x) => x.cost.total <= form.budget && x.cost.mode !== 'Flight estimate'));
});

test('conflicts cover explicit origin, length, party size and budget mode without overwriting form', () => {
  const altered = structuredClone(analysis);
  altered.mentioned = { origin: 'Boston', budget: 900, days: 7, travelers: 4, date: '2026-12-01' };
  altered.hardConstraints.budgetIntent = 'flexible';
  const conflicts = detectConflicts(altered, form);
  assert.equal(conflicts.length, 6);
  altered.mentioned.origin = 'New York';
  assert.equal(detectConflicts(altered, form).length, 5);
});

test('no key, upstream failure and invalid structured data never fabricate AI success', async () => {
  await assert.rejects(analyzeWithOpenAI({ text: 'Quiet beaches', form, apiKey: '' }), (error) => error.code === 'unavailable');
  await assert.rejects(analyzeWithOpenAI({ text: 'Quiet beaches', form, apiKey: 'test-only', fetchImpl: async () => ({ ok: false }) }), (error) => error.code === 'upstream');
  await assert.rejects(analyzeWithOpenAI({ text: 'Quiet beaches', form, apiKey: 'test-only', fetchImpl: async () => apiResponse({ ...analysis, interests: ['invented'] }) }), (error) => error.code === 'bad_output');
  await assert.rejects(analyzeWithOpenAI({ text: 'Quiet beaches', form, apiKey: 'test-only', fetchImpl: async () => apiResponse({ ...analysis, mentioned: null }) }), (error) => error.code === 'bad_output');
  await assert.rejects(analyzeWithOpenAI({ text: 'Quiet beaches', form, apiKey: 'test-only', fetchImpl: async () => ({ ok: true, async json() { return { status: 'completed', output: [] }; } }) }), (error) => error.code === 'bad_output');
  assert.throws(() => validateAnalysis({ ...analysis, hardConstraints: { ...analysis.hardConstraints, noFlights: 'yes' } }), PreferenceError);
});

test('AI spending priorities do not alter prices or hard eligibility without quality data', () => {
  const base = { origin: resolveOrigin(form.origin), date: new Date(`${form.date}T12:00:00Z`), days: 3, travelers: 2, budget: 1200, selected: ['food'], constraints: { noCar: true } };
  const food = recommend({ ...base, spendingPriorities: ['food'] });
  const stay = recommend({ ...base, spendingPriorities: ['accommodation'] });
  assert.deepEqual(food.results.map((x) => [x.id, x.cost.total, x.score]), stay.results.map((x) => [x.id, x.cost.total, x.score]));
});
