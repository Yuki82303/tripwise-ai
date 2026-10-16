import test from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_PHOTOS, DESTINATIONS } from '../src/data.js';
import { DEFAULT_WEIGHTS, describeResultState, estimateCost, parsePreferences, recommend, resolveOrigin, validateSearch } from '../src/engine.js';

const base = {
  origin: resolveOrigin('New York, NY'), date: new Date('2027-05-20T12:00:00Z'),
  days: 3, travelers: 2, budget: 1600, selected: ['food', 'city'], constraints: {}, weights: DEFAULT_WEIGHTS
};

test('catalog has at least 30 unique regional demo profiles; supplied photos have source links', () => {
  assert.ok(DESTINATIONS.length >= 30);
  assert.equal(new Set(DESTINATIONS.map((d) => d.id)).size, DESTINATIONS.length);
  assert.ok(DESTINATIONS.every((d) => !d.photo || d.photo.source.startsWith('https://commons.wikimedia.org/wiki/File:')));
  assert.ok(DESTINATIONS.every((d) => d.bestMonths.length && d.tags.length && d.idealDays.length === 2 && Number.isFinite(d.nightly) && Number.isFinite(d.daily) && Number.isFinite(d.carFree)));
  for (const id of ['philadelphia', 'washington-dc', 'boston', 'providence', 'baltimore', 'hudson-valley', 'milwaukee', 'long-beach']) assert.ok(DESTINATIONS.some((d) => d.id === id));
});

test('new photo catalog has distinct city-specific Commons sources and attribution metadata', () => {
  assert.equal(Object.keys(CURATED_PHOTOS).length, 12);
  assert.equal(new Set(Object.values(CURATED_PHOTOS).map((photo) => photo.source)).size, 12);
  for (const [id, photo] of Object.entries(CURATED_PHOTOS)) {
    assert.deepEqual(DESTINATIONS.find((destination) => destination.id === id)?.photo, photo);
    assert.match(photo.localUrl, new RegExp(`^/assets/destinations/${id}\\.jpg$`));
    assert.ok(photo.url.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/'));
    assert.ok(photo.credit && photo.license && photo.subject);
  }
});

test('rule parser extracts preferences and hard constraints without claiming an LLM', () => {
  const parsed = parsePreferences('Warm beach, great food, low budget, no flights and no rental car');
  assert.equal(parsed.source, 'Demo Rule-based Matching');
  assert.deepEqual(parsed.selected.sort(), ['beach', 'budget', 'food', 'warm']);
  assert.equal(parsed.constraints.noFlights, true);
  assert.equal(parsed.constraints.noCar, true);
  assert.equal(parsePreferences('not beach').selected.includes('beach'), false);
});

test('local parser separates negated interests, travel style and spending wishes', () => {
  const parsed = parsePreferences('Quiet city weekend, not interested in beaches. Prefer walking and spend more on food. Flexible budget, no rental car.');
  assert.ok(parsed.selected.includes('city'));
  assert.ok(!parsed.selected.includes('beach'));
  assert.ok(parsed.avoidInterests.includes('beach'));
  assert.ok(parsed.styles.includes('quiet'));
  assert.ok(parsed.softPreferences.includes('walking'));
  assert.ok(parsed.spendingPriorities.includes('food'));
  assert.equal(parsed.budgetIntent, 'flexible');
  assert.equal(parsed.constraints.noCar, true);
  assert.equal(parsed.constraints.noFlights, false);
});

test('search validation rejects unsupported origin, bad budget and past date', () => {
  const bad = validateSearch({ origin: 'Unknown, XX', budget: 0, date: '2020-01-01', days: 3, travelers: 2, text: '' }, new Date('2026-10-16T12:00:00Z'));
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.origin && bad.errors.budget && bad.errors.date);
  const impossibleDate = validateSearch({ origin: 'Boston, MA', budget: 900, date: '2027-02-30', days: 3, travelers: 2, text: '' }, new Date('2026-10-16T12:00:00Z'));
  assert.ok(impossibleDate.errors.date);
});

test('cost midpoint is the sum of shown categories and changes with party size', () => {
  const destination = DESTINATIONS.find((d) => d.id === 'miami');
  const one = estimateCost(destination, base.origin, base.date, 3, 1);
  const three = estimateCost(destination, base.origin, base.date, 3, 3);
  assert.equal(one.total, one.transport + one.lodging + one.other + one.buffer);
  assert.ok(three.total > one.total);
  assert.equal(three.rooms, 2);
});

test('no flights and no car stay separate; known rail corridors qualify and unknown ground access does not', () => {
  const parsed = parsePreferences('Great food, no rental car');
  assert.equal(parsed.constraints.noCar, true);
  assert.equal(parsed.constraints.noFlights, false);
  const { results, needsVerification } = recommend({ ...base, budget: 10000, constraints: { noFlights: true, noCar: true } });
  assert.ok(results.length > 0);
  assert.ok(results.every((d) => d.cost.routeKnown && d.cost.mode === 'Rail candidate' && d.carFree >= 65));
  assert.ok(needsVerification.length > 0);
  assert.ok(needsVerification.every((d) => !d.cost.routeKnown && d.cost.groundAvailable && d.carFree >= 65 && d.status === 'unverified'));
});

test('budget, origin and preference changes affect ranking or eligible results', () => {
  const broad = recommend({ ...base, budget: 10000 });
  const tight = recommend({ ...base, budget: 900 });
  assert.ok(tight.totalCandidates < broad.totalCandidates);
  const beach = recommend({ ...base, budget: 10000, selected: ['beach'], weights: { preference: 60, budget: 10, travel: 15, experience: 15 } });
  const city = recommend({ ...base, budget: 10000, selected: ['city'], weights: { preference: 60, budget: 10, travel: 15, experience: 15 } });
  assert.notDeepEqual(beach.results.map((d) => d.id), city.results.map((d) => d.id));
  const west = recommend({ ...base, origin: resolveOrigin('Los Angeles, CA'), budget: 10000 });
  assert.notDeepEqual(broad.results.map((d) => d.id), west.results.map((d) => d.id));
});

const reportedScenario = {
  ...base, date: new Date('2026-11-06T12:00:00Z'), budget: 1200,
  selected: ['food', 'city'], constraints: { noFlights: false, noCar: true, directOnly: false }
};

test('A: strict $1,200 budget excludes Savannah and Chicago from feasible ranking', () => {
  const outcome = recommend(reportedScenario);
  assert.equal(outcome.results.length, 5);
  assert.ok(['philadelphia','new-haven','providence','baltimore'].every((id) => outcome.results.some((d) => d.id === id)));
  assert.ok(outcome.results.every((d) => d.status === 'feasible' && d.cost.total <= 1200));
  assert.ok(outcome.stretches.every((d) => d.status === 'stretch' && d.cost.total > 1200));
  assert.ok(outcome.results.some((d) => d.priceRisk === 'upper-range-over'));
});

test('B: Flexible Budget shows a separate stretch tier; higher cap changes feasible ranking', () => {
  const flexible = recommend({ ...reportedScenario, budgetMode: 'flexible' });
  assert.ok(flexible.results.length >= 3);
  assert.ok(flexible.stretches.some((d) => d.id === 'savannah'));
  assert.ok(flexible.stretches.some((d) => d.id === 'chicago'));
  assert.ok(flexible.stretches.every((d) => d.status === 'stretch' && d.cost.total > 1200));
  const higher = recommend({ ...reportedScenario, budget: 1350 });
  assert.ok(higher.totalCandidates > flexible.totalCandidates);
  assert.ok(!higher.stretches.some((d) => ['savannah','chicago'].includes(d.id)));
});

test('C: no flights excludes every candidate requiring a modeled flight', () => {
  const noFlights = recommend({ ...base, budget: 10000, constraints: { noFlights: true } });
  assert.ok(noFlights.results.length > 0);
  assert.ok(noFlights.results.every((d) => d.cost.mode !== 'Flight estimate'));
  assert.ok(noFlights.exclusionCounts.noFlights > 0);
});

test('D: seven days increases total cost but reduces distance burden per day', () => {
  const philadelphia = DESTINATIONS.filter((d) => d.id === 'philadelphia');
  const three = recommend({ ...base, budget: 10000, days: 3 }, philadelphia).results[0];
  const seven = recommend({ ...base, budget: 10000, days: 7 }, philadelphia).results[0];
  assert.ok(seven.cost.total > three.cost.total);
  assert.ok(seven.components.travel > three.components.travel);
  assert.ok(seven.travelBurden < three.travelBurden);
  assert.equal(three.cost.total, three.cost.transport + three.cost.lodging + three.cost.other + three.cost.buffer);
});

test('E: weight changes affect scores but never restore an over-budget feasible result', () => {
  const preferencesFirst = recommend({ ...reportedScenario, weights: { preference: 60, budget: 5, travel: 15, experience: 20 } });
  const budgetFirst = recommend({ ...reportedScenario, weights: { preference: 5, budget: 60, travel: 15, experience: 20 } });
  assert.notEqual(preferencesFirst.results[0].score, budgetFirst.results[0].score);
  for (const outcome of [preferencesFirst, budgetFirst]) {
    assert.ok(outcome.results.every((d) => d.cost.total <= reportedScenario.budget));
    assert.ok(!outcome.results.some((d) => ['savannah', 'chicago'].includes(d.id)));
  }
  const beachSearch = { ...base, budget: 2500, selected: ['beach'], constraints: {}, date: new Date('2026-11-06T12:00:00Z') };
  const beachFirst = recommend({ ...beachSearch, weights: { preference: 60, budget: 5, travel: 15, experience: 20 } });
  const priceFirst = recommend({ ...beachSearch, weights: { preference: 5, budget: 60, travel: 15, experience: 20 } });
  assert.notDeepEqual(beachFirst.results.map((d) => d.id), priceFirst.results.map((d) => d.id));
});

test('F: empty state names failed limits and suggests a concrete adjustment', () => {
  const outcome = recommend({ ...reportedScenario, budget: 100, constraints: { noFlights: true, noCar: true } });
  const state = describeResultState(outcome);
  assert.equal(outcome.results.length, 0);
  assert.equal(state.empty, true);
  assert.match(state.title, /No within-budget/);
  assert.ok(state.detail.includes('budget'));
  assert.ok(state.suggestions.some((text) => /budget|flight|ground/i.test(text)));
});

test('unverified nonstop requirement never counts as feasible based on distance alone', () => {
  const outcome = recommend({ ...base, budget: 10000, constraints: { directOnly: true } });
  assert.ok(outcome.needsVerification.length > 0);
  assert.ok(outcome.results.every((d) => d.cost.mode !== 'Flight estimate'));
  assert.ok(outcome.needsVerification.every((d) => d.status === 'unverified'));
});

test('new destinations participate in dynamic scoring across origins and budgets', () => {
  const cases = ['Boston, MA','Chicago, IL','Los Angeles, CA','San Francisco, CA','Seattle, WA'];
  for (const city of cases) {
    const outcome = recommend({ ...reportedScenario, origin: resolveOrigin(city), budget: 1800 });
    assert.ok(outcome.results.length >= 2, city);
    assert.ok(outcome.results.some((d) => ['philadelphia','providence','milwaukee','long-beach','tacoma','portland-oregon'].includes(d.id)), city);
    assert.ok(outcome.results.every((d) => d.cost.total <= 1800));
  }
  const citySearch = recommend({ ...reportedScenario, budget: 1800, selected: ['city'], weights: { preference: 60, budget: 10, travel: 15, experience: 15 } });
  const natureSearch = recommend({ ...reportedScenario, budget: 1800, selected: ['nature'], weights: { preference: 60, budget: 10, travel: 15, experience: 15 } });
  assert.notDeepEqual(citySearch.results.map((d) => d.id), natureSearch.results.map((d) => d.id));
});

test('unknown ground routes remain unverified; no-flight and no-car rules never promote them', () => {
  const outcome = recommend({ ...reportedScenario, budget: 10000, constraints: { noFlights: true, noCar: true } });
  assert.ok(outcome.results.every((d) => d.cost.routeKnown && d.cost.mode === 'Rail candidate' && d.carFree >= 65));
  assert.ok(outcome.needsVerification.every((d) => !d.cost.routeKnown));
  assert.ok(outcome.explore.some((d) => d.status === 'excluded'));
  assert.ok(outcome.results.every((d) => d.cost.timeKnown === false));
});

test('shortlist, stretch and explore never hide status or turn an over-budget midpoint feasible', () => {
  const outcome = recommend(reportedScenario);
  assert.ok(outcome.results.length >= 3 && outcome.results.length <= 5);
  assert.ok(outcome.stretches.length >= 2 && outcome.stretches.length <= 3);
  assert.ok(outcome.stretches.every((d) => d.budgetDifference < 0 && d.stretchAdjustment));
  assert.ok(outcome.explore.length > 0);
  const ids = [...outcome.results, ...outcome.stretches, ...outcome.needsVerification, ...outcome.explore].map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('complete tag overlap does not imply verified travel ease or data confidence', () => {
  const outcome = recommend(reportedScenario);
  assert.ok(outcome.results.some((item) => item.preferenceMatch.score === 100));
  assert.ok(outcome.results.every((item) => item.components.travel < 80));
  assert.ok(outcome.results.every((item) => item.dataConfidence.level === 'Provisional' && /not verified/.test(item.dataConfidence.reason)));
  assert.ok(outcome.results.every((item) => item.score < 95));
});
