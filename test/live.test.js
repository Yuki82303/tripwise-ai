import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SerpClient, parseFlightPair, parseHotels, parseDiscussions, selectOutboundToken } from '../serpapi.mjs';
import { checkDestination, tripDates } from '../travel-live.mjs';
import { mergeLiveQuotes } from '../src/live.js';
import { recommend, resolveOrigin } from '../src/engine.js';

const fixture = async (name) => JSON.parse(await readFile(resolve('test/fixtures', name), 'utf8'));
const args = { from: 'JFK', to: 'ORD', depart: '2026-11-06', returnDate: '2026-11-08', travelers: 2, checkedAt: '2026-10-16T12:00:00Z', freshness: 'live' };

test('Google Flights-style round trip requires selected return leg, matching dates, passengers and direct constraint', async () => {
  const outbound = await fixture('flights-outbound.json'), returning = await fixture('flights-return.json');
  assert.equal(selectOutboundToken(outbound, args), 'fixture-return-token');
  const quote = parseFlightPair(outbound, returning, args);
  assert.equal(quote.groupFare, null);
  assert.equal(quote.groupFareEstimate, 820);
  assert.equal(quote.farePerTraveler, 410);
  const oneOutbound = structuredClone(outbound), oneReturn = structuredClone(returning);
  oneOutbound.search_parameters.adults = 1; oneReturn.search_parameters.adults = 1;
  assert.equal(parseFlightPair(oneOutbound, oneReturn, { ...args, travelers: 1 }).groupFare, 410);
  assert.equal(quote.outbound.airline, 'Example Air');
  assert.equal(quote.returning.durationMinutes, 130);
  assert.equal(parseFlightPair(outbound, { ...returning, search_parameters: { ...returning.search_parameters, departure_token: 'wrong' } }, args).status, 'unavailable');
  assert.equal(parseFlightPair(outbound, { ...returning, best_flights: [] }, args).status, 'unavailable');
  assert.equal(parseFlightPair(outbound, { ...returning, search_parameters: { ...returning.search_parameters, return_date: '2026-11-09' } }, args).status, 'unavailable');
  assert.equal(parseFlightPair(outbound, returning, { ...args, travelers: 3 }).status, 'unavailable');
  const connecting = structuredClone(returning); connecting.best_flights[0].layovers = [{ id: 'DTW' }];
  assert.equal(parseFlightPair(outbound, connecting, { ...args, directOnly: true }).status, 'unavailable');
});

test('Google Hotels-style quote uses whole stay, and search previews never become verified quotes or engagement', async () => {
  const hotel = parseHotels(await fixture('hotels.json'), { checkIn: '2026-11-06', checkOut: '2026-11-08', travelers: 2, rooms: 1, nights: 2, checkedAt: args.checkedAt, freshness: 'live' });
  assert.equal(hotel.totalStay, 286);
  assert.equal(hotel.nights, 2);
  assert.equal(hotel.checkIn, '2026-11-06');
  assert.equal(hotel.checkOut, '2026-11-08');
  assert.equal(hotel.taxesIncluded, true);
  const nightlyOnly = await fixture('hotels.json'); delete nightlyOnly.properties[0].total_rate;
  assert.equal(parseHotels(nightlyOnly, { checkIn: '2026-11-06', checkOut: '2026-11-08', travelers: 2, rooms: 1, nights: 2 }).status, 'unavailable');
  assert.equal(parseHotels(await fixture('hotels.json'), { checkIn: '2026-11-06', checkOut: '2026-11-08', travelers: 3, rooms: 2, nights: 2 }).status, 'unavailable');
  const voices = parseDiscussions(await fixture('discussions.json'), args.checkedAt, 'live');
  assert.equal(voices.discussions.length, 1);
  assert.equal(voices.engagementVerified, false);
  assert.equal(parseDiscussions(await fixture('discussions.json'), args.checkedAt, 'live', { city: 'Boston' }).discussions.length, 0);
  assert.match(voices.discussions[0].url, /^https:\/\/www\.reddit\.com/);
  assert.equal(tripDates('2026-11-06', 3).nights, 2);
});

test('server-side SerpApi MCP client keeps key in header, caches results and enforces persisted local daily cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripwise-serp-'));
  await mkdir(join(root, 'data'));
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    const request = JSON.parse(init.body);
    const result = request.method === 'tools/call' ? { structuredContent: { result: JSON.stringify(await fixture('discussions.json')) } } : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const client = new SerpClient({ apiKey: 'test-secret-only', root, fetchImpl, dailyLimit: 1, now: () => Date.parse(args.checkedAt) });
    const first = await client.search({ engine: 'google', q: 'Chicago' });
    const second = await client.search({ engine: 'google', q: 'Chicago' });
    assert.equal(first.freshness, 'live'); assert.equal(second.freshness, 'cached');
    assert.equal((await client.usage()).count, 1);
    assert.ok(seen.every(({ url }) => !url.includes('test-secret-only')));
    assert.ok(seen.every(({ init }) => init.headers.Authorization === 'Bearer test-secret-only'));
    await assert.rejects(client.search({ engine: 'google', q: 'Boston' }), { code: 'daily_limit' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('SerpApi HTTP 429 is identified as a provider limit without exposing credentials', async () => {
  const client = new SerpClient({ apiKey: 'test-secret-only', fetchImpl: async () => new Response('{}', { status: 429 }) });
  await assert.rejects(client.rpc('initialize', {}), (error) => error.code === 'provider_limit' && !error.message.includes('test-secret-only'));
});

test('quote-supported cost reranks but never turns an over-budget candidate feasible', async () => {
  const search = { origin: resolveOrigin('New York, NY'), date: new Date('2026-11-06T12:00:00Z'), days: 3, travelers: 2, budget: 1200, budgetMode: 'strict', selected: ['food','city'], constraints: { noFlights: false, noCar: true, directOnly: false }, weights: { preference: 35, budget: 25, travel: 20, experience: 20 } };
  const base = recommend(search);
  const item = base.results[0];
  const over = { destinationId: item.id, status: 'live', flight: { outbound: { durationMinutes: 100, layovers: 0 }, returning: { durationMinutes: 100, layovers: 0 } }, hotel: {}, estimate: { low: 1300, high: 1600, midpoint: 1450 } };
  const result = mergeLiveQuotes(base, { [item.id]: over }, search);
  assert.ok(!result.results.some((pick) => pick.id === item.id));
  assert.ok([...result.stretches, ...result.explore].some((pick) => pick.id === item.id));
  const noQuote = mergeLiveQuotes(base, { [item.id]: { status: 'unverified' } }, search);
  assert.equal(noQuote.results.find((pick) => pick.id === item.id)?.score, item.score);
});

test('a confirmed nonstop round trip may resolve an unverified direct-flight candidate, but no-flights remains hard', () => {
  const search = { origin: resolveOrigin('New York, NY'), date: new Date('2026-11-06T12:00:00Z'), days: 3, travelers: 2, budget: 3000, budgetMode: 'strict', selected: ['food'], constraints: { noFlights: false, noCar: false, directOnly: true } };
  const base = recommend(search);
  const candidate = [...base.needsVerification, ...base.explore].find((item) => item.status === 'unverified' && item.cost.mode === 'Flight estimate');
  assert.ok(candidate);
  const quote = { status: 'live', flight: { outbound: { durationMinutes: 130, layovers: 0 }, returning: { durationMinutes: 130, layovers: 0 } }, estimate: { low: 900, high: 1200, midpoint: 1050 } };
  assert.ok(mergeLiveQuotes(base, { [candidate.id]: quote }, search).results.some((item) => item.id === candidate.id));
  assert.ok(!mergeLiveQuotes(base, { [candidate.id]: quote }, { ...search, constraints: { ...search.constraints, noFlights: true } }).results.some((item) => item.id === candidate.id));
});

test('end-to-end orchestration with mock official shapes derives group total without pretending local costs are verified', async () => {
  const outbound = await fixture('flights-outbound.json'), returning = await fixture('flights-return.json'), hotels = await fixture('hotels.json');
  const seen = [];
  const client = { async search(params) { seen.push(params); return { data: params.engine === 'google_hotels' ? hotels : params.departure_token ? returning : outbound, checkedAt: args.checkedAt, freshness: 'live' }; } };
  const result = await checkDestination(client, { originId: 'new-york', destinationId: 'chicago', date: '2026-11-06', days: 3, travelers: 2, modeledOther: 420 });
  assert.equal(seen.length, 3);
  assert.equal(result.verifiedCosts, 286);
  assert.equal(result.estimatedCosts.localExpenses, 420);
  assert.equal(result.status, 'unverified');
  assert.equal(result.estimate, null);
  const ground = await checkDestination(client, { originId: 'new-york', destinationId: 'chicago', date: '2026-11-06', days: 3, travelers: 2, noFlights: true, modeledOther: 420 });
  assert.equal(ground.flight.status, 'unavailable');
  assert.equal(ground.status, 'unverified');
});

test('one-traveler matching round trip and full hotel stay produce a quote-supported estimate', async () => {
  const outbound = await fixture('flights-outbound.json'), returning = await fixture('flights-return.json'), hotels = await fixture('hotels.json');
  outbound.search_parameters.adults = 1;
  returning.search_parameters.adults = 1;
  hotels.search_parameters.adults = 1;
  const client = { async search(params) { return { data: params.engine === 'google_hotels' ? hotels : params.departure_token ? returning : outbound, checkedAt: args.checkedAt, freshness: 'live' }; } };
  const result = await checkDestination(client, { originId: 'new-york', destinationId: 'chicago', date: '2026-11-06', days: 3, travelers: 1, modeledOther: 210 });
  assert.equal(result.flight.groupFare, 410);
  assert.equal(result.hotel.totalStay, 286);
  assert.equal(result.verifiedCosts, 696);
  assert.equal(result.estimate.midpoint, 997);
  assert.equal(result.status, 'live');
  assert.equal(result.hotel.nights, 2);
});

test('rail corridor makes no flight search and never claims a complete live group price', async () => {
  const hotels = await fixture('hotels.json');
  const calls = [];
  const client = { async search(params) { calls.push(params); return { data: hotels, checkedAt: args.checkedAt, freshness: 'live' }; } };
  const result = await checkDestination(client, { originId: 'new-york', destinationId: 'philadelphia', date: '2026-11-06', days: 3, travelers: 2, modeledOther: 300 });
  assert.equal(result.transportMode, 'rail');
  assert.equal(result.status, 'unverified');
  assert.equal(result.estimate, null);
  assert.equal(result.flight.status, 'unavailable');
  assert.ok(result.railOperatorUrl?.startsWith('https://'));
  assert.deepEqual(calls.map((item) => item.engine), ['google_hotels']);
});

test('multi-room hotel search is skipped instead of spending a query on an unverifiable stay', async () => {
  const calls = [];
  const client = { async search(params) { calls.push(params); return { data: await fixture('flights-outbound.json'), checkedAt: args.checkedAt, freshness: 'live' }; } };
  const result = await checkDestination(client, { originId: 'new-york', destinationId: 'chicago', date: '2026-11-06', days: 3, travelers: 3, modeledOther: 630 });
  assert.ok(calls.every((params) => params.engine !== 'google_hotels'));
  assert.match(result.hotel.reason, /Multi-room occupancy/);
  assert.equal(result.status, 'unverified');
});
