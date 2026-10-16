import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { normalizeQuote, readCommunityQuotes } from '../community.mjs';
import { getNwsForecast } from '../weather.mjs';
import { analyzeWithOllama, ollamaReady } from '../ollama.mjs';
import { recommend, resolveOrigin } from '../src/engine.js';
import { destinationEvidence } from '../src/sources.js';

test('community import accepts only short source-linked entries and starts empty', async () => {
  const config = { platform: 'Xiaohongshu', hosts: ['www.xiaohongshu.com'] };
  const valid = { destination: 'philadelphia', quote: 'The historic center was pleasant to walk around.', theme: 'walkability', date: '2026-05-12', noteTitle: 'A weekend in Philly', sourceLink: 'https://www.xiaohongshu.com/explore/example' };
  assert.equal(normalizeQuote(valid, config).platform, 'Xiaohongshu');
  assert.equal(normalizeQuote({ ...valid, sourceLink: 'https://evil.example/post' }, config), null);
  assert.equal(normalizeQuote({ ...valid, quote: 'Nice' }, config), null);
  assert.equal(normalizeQuote({ ...valid, destination: 'missing' }, config), null);
  assert.deepEqual(await readCommunityQuotes(resolve('.'), 'philadelphia'), []);
});

test('manual Xiaohongshu and Reddit records appear by destination with source details', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripwise-voices-'));
  try {
    await mkdir(join(root, 'data'));
    const base = { destination: 'new-haven', quote: 'The campus walk made the afternoon feel relaxed.', theme: 'walkability', date: '2026-05-12', noteTitle: 'Example fixture' };
    await writeFile(join(root, 'data/xiaohongshu_manual_quotes.json'), JSON.stringify([{ ...base, sourceLink: 'https://www.xiaohongshu.com/explore/example' }]));
    await writeFile(join(root, 'data/reddit_manual_quotes.json'), JSON.stringify([{ ...base, date: '2026-06-02', sourceLink: 'https://www.reddit.com/r/travel/comments/example/post/' }]));
    const quotes = await readCommunityQuotes(root, 'new-haven');
    assert.equal(quotes.length, 2);
    assert.deepEqual(quotes.map((item) => item.platform), ['Reddit', 'Xiaohongshu']);
    assert.ok(quotes.every((item) => item.sourceType === 'curated-community' && item.sourceLink.startsWith('https://')));
    assert.deepEqual(await readCommunityQuotes(root, 'boston'), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('official forecast is requested only for a near date and rejects untrusted forecast URLs', async () => {
  let calls = 0;
  const today = new Date('2026-10-16T12:00:00Z');
  const far = await getNwsForecast({ destinationId: 'philadelphia', date: '2026-11-16', now: today, fetchImpl: async () => { calls++; throw Error('No request expected'); } });
  assert.equal(far.available, false);
  assert.equal(calls, 0);
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes('/points/')) return { ok: true, async json() { return { properties: { forecast: 'https://api.weather.gov/gridpoints/PHI/50,70/forecast' } }; } };
    return { ok: true, async json() { return { properties: { periods: [{ isDaytime: true, startTime: '2026-10-19T06:00:00-04:00', shortForecast: 'Mostly Sunny', temperature: 65, temperatureUnit: 'F' }] } }; } };
  };
  const near = await getNwsForecast({ destinationId: 'philadelphia', date: '2026-10-19', now: today, fetchImpl });
  assert.equal(near.available, true);
  assert.equal(near.summary, 'Mostly Sunny');
  assert.equal(calls, 2);
  const unsafe = await getNwsForecast({ destinationId: 'philadelphia', date: '2026-10-19', now: today, fetchImpl: async () => ({ ok: true, async json() { return { properties: { forecast: 'https://evil.example/forecast' } }; } }) });
  assert.equal(unsafe.available, false);
});

test('optional Ollama adapter validates structured output and falls back when service is absent', async () => {
  assert.equal(await ollamaReady(async () => { throw Error('offline'); }), false);
  const analysis = { interests: ['food'], avoidInterests: [], styles: ['quiet'], avoidStyles: [], softPreferences: [], spendingPriorities: ['food'], hardConstraints: { noFlights: false, noCar: true, directOnly: false, budgetIntent: 'unspecified' }, mentioned: { origin: null, budget: null, days: null, travelers: null, date: null }, ambiguities: [] };
  const form = { origin: 'New York, NY', budget: 1200, date: '2026-11-06', days: 3, travelers: 2, budgetMode: 'strict' };
  const good = await analyzeWithOllama({ text: 'Quiet food getaway, no rental car', form, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(options.body).model, 'qwen2.5:1.5b');
    return { ok: true, async json() { return { message: { content: JSON.stringify(analysis) } }; } };
  } });
  assert.equal(good.source, 'Local AI Preference Analysis (Ollama)');
  await assert.rejects(analyzeWithOllama({ text: 'Quiet food getaway', form, fetchImpl: async () => ({ ok: true, async json() { return { message: { content: '{broken' } }; } }) }), /invalid JSON/);
});

test('weight presets visibly reorder the strict shortlist while preserving hard budget limits', () => {
  const input = { origin: resolveOrigin('New York, NY'), date: new Date('2026-11-06T12:00:00Z'), days: 3, travelers: 2, budget: 1200, selected: ['food','city'], constraints: { noCar: true } };
  const baseline = recommend(input);
  const season = recommend({ ...input, weights: { preference: 5, budget: 5, travel: 5, experience: 85 } });
  const cheap = recommend({ ...input, weights: { preference: 5, budget: 85, travel: 5, experience: 5 } });
  assert.notDeepEqual(baseline.results.map((item) => item.id), season.results.map((item) => item.id));
  assert.notDeepEqual(season.results.map((item) => item.id), cheap.results.map((item) => item.id));
  assert.ok([baseline, season, cheap].every((run) => run.results.every((item) => item.cost.total <= 1200 && item.status === 'feasible')));
  assert.ok(Math.abs(Object.values(season.effectiveWeights).reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
  assert.equal(destinationEvidence(baseline.results[0]).find((record) => record.type === 'modeled')?.label, 'Group budget & distance burden');
});
