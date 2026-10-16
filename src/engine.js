import { DESTINATIONS, ORIGINS, PREFERENCE_LABELS, RAIL_CORRIDORS, STYLE_LABELS, SOFT_LABELS } from './data.js';

export const DEFAULT_WEIGHTS = Object.freeze({ preference: 35, budget: 25, travel: 20, experience: 20 });

const RULES = {
  beach: [/\b(beach(?:es)?|ocean|coast|seaside|sea|surf)\b/i, /海边|海滩/],
  nature: [/\b(nature|hiking|hike|mountain|outdoors|trail|forest|park)\b/i, /自然|徒步|山/],
  city: [/\b(city|urban|nightlife|museum|architecture)\b/i, /城市|都市|夜生活/],
  food: [/\b(food|foodie|restaurant|eat|cuisine|dining|seafood)\b/i, /美食|吃/],
  culture: [/\b(culture|history|historic|art|gallery)\b/i, /文化|历史|艺术/],
  nightlife: [/\b(nightlife|nightclubs?|bars|live music)\b/i, /夜生活|酒吧/],
  warm: [/\b(warm|sunny|sunshine|hot weather|winter sun)\b/i, /温暖|暖和|阳光/],
  budget: [/\b(cheap|affordable|low budget|budget-friendly|save money|inexpensive)\b/i, /便宜|省钱|低预算/]
};

const NEGATION = /\b(?:no|not|avoid|skip|without|don't want|do not want|not interested in)\s+(?:(?:a|the|any|much|very)\s+)?$/i;
const STYLE_RULES = {
  relaxing: /\b(relax(?:ing|ed)?|slow[- ]paced|unwind|restful)\b/i,
  adventurous: /\b(adventure|adventurous|explor(?:e|ing)|active trip)\b/i,
  romantic: /\b(romantic|anniversary|couples? getaway)\b/i,
  quiet: /\b(quiet|peaceful|calm|low[- ]key)\b/i,
  less_touristy: /\b(less touristy|off the beaten path|avoid tourist traps|local vibe)\b/i
};

/** First-stage adapter: a future LLM adapter can return the same shape. */
export function parsePreferences(text = '') {
  const input = String(text).slice(0, 500);
  const matches = (pattern) => [...input.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))];
  const negated = (index) => NEGATION.test(input.slice(Math.max(0, index - 40), index));
  const selected = Object.entries(RULES).filter(([, patterns]) => patterns.some((pattern) => matches(pattern).some((match) => !negated(match.index)))).map(([key]) => key);
  const avoidInterests = Object.entries(RULES).filter(([, patterns]) => patterns.some((pattern) => matches(pattern).some((match) => negated(match.index)))).map(([key]) => key);
  const styles = Object.entries(STYLE_RULES).filter(([, pattern]) => matches(pattern).some((match) => !negated(match.index))).map(([key]) => key);
  const avoidStyles = Object.entries(STYLE_RULES).filter(([, pattern]) => matches(pattern).some((match) => negated(match.index))).map(([key]) => key);
  const softPreferences = [
    /\b(prefer|would like|ideally)\s+(?:a\s+)?(?:nonstop|direct)\s+flights?\b/i.test(input) ? 'direct_flights' : null,
    /\b(prefer|love|want)\s+(?:to\s+)?walk(?:ing|able)?\b|\bwalkable\b/i.test(input) ? 'walking' : null,
    /\b(prefer|want|like)\s+warm(?:er)?\s+weather\b/i.test(input) ? 'warm_weather' : null
  ].filter(Boolean);
  const spendingPriorities = [
    /\b(?:splurge|spend more|prioriti[sz]e|save room)\s+(?:on|for)\s+(?:a\s+)?(?:hotel|stay|lodging|accommodation)\b/i.test(input) ? 'accommodation' : null,
    /\b(?:splurge|spend more|prioriti[sz]e|save room)\s+(?:on|for)\s+(?:great\s+)?(?:food|restaurants?|dining)\b/i.test(input) ? 'food' : null,
    /\b(?:splurge|spend more|prioriti[sz]e|save room)\s+(?:on|for)\s+(?:experiences?|activities|museums?|shows?)\b/i.test(input) ? 'experiences' : null,
    /\b(?:splurge|spend more|prioriti[sz]e|save room)\s+(?:on|for)\s+(?:travel|transportation|flights?|trains?)\b/i.test(input) ? 'transportation' : null
  ].filter(Boolean);

  return {
    source: 'Demo Rule-based Matching',
    selected, avoidInterests, styles, avoidStyles, softPreferences, spendingPriorities,
    budgetIntent: /\b(?:strict|hard|firm)\s+budget\b/i.test(input) ? 'strict' : /\b(?:flexible|stretch|can go over)\s+budget\b/i.test(input) ? 'flexible' : 'unspecified',
    constraints: {
      noFlights: /\b(no flights?|no flying|avoid flights?|don't want to fly|do not want to fly|train only|road trip only)\b/i.test(input) || /不坐飞机|不要坐飞机|不飞/.test(input),
      noCar: /\b(no (rental )?car|no driving|without (a )?car|don't want to (rent|drive)|do not want to (rent|drive))\b/i.test(input) || /不租车|不开车/.test(input),
      directOnly: /\b(no layovers?|nonstop|direct flights? only|no connections?)\b/i.test(input) || /不转机|直飞/.test(input)
    }
  };
}

export function resolveOrigin(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ORIGINS.find((origin) => [origin.name.toLowerCase(), origin.id, origin.name.split(',')[0].toLowerCase()].includes(normalized));
}

export function validateSearch(input, today = new Date()) {
  const errors = {};
  const origin = resolveOrigin(input.origin);
  if (!origin) errors.origin = 'Choose one of the supported departure cities.';
  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget < 100 || budget > 30000) errors.budget = 'Enter a total group budget between $100 and $30,000.';
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 2 || days > 7) errors.days = 'Choose 2–7 travel days.';
  const travelers = Number(input.travelers);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 4) errors.travelers = 'Choose 1–4 travelers.';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? new Date(`${input.date}T12:00:00Z`) : new Date(NaN);
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.date || date.getTime() < todayUTC || date.getTime() > todayUTC + 366 * 86400000) errors.date = 'Choose a departure date within the next 12 months.';
  if (String(input.text || '').length > 500) errors.text = 'Keep preferences under 500 characters.';
  return { valid: Object.keys(errors).length === 0, errors, origin, budget, days, travelers, date };
}

function milesBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(3959 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

const round = (value) => Math.round(value);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function estimateCost(destination, origin, date, days, travelers, noFlights = false) {
  const miles = milesBetween(origin, destination);
  const rail = RAIL_CORRIDORS.find((corridor) => corridor.ids.includes(origin.id) && corridor.ids.includes(destination.id));
  const groundAvailable = miles <= 460; // Distance screen only; not a route claim.
  const mode = rail ? 'Rail candidate' : miles <= 250 ? 'Coach candidate' : groundAvailable ? 'Ground route unknown' : 'Flight estimate';
  // These are illustrative budget inputs, never fare quotes or confirmed routes.
  const transport = rail ? round((45 + miles * 0.33) * travelers)
    : mode === 'Coach candidate' ? round((38 + miles * 0.28) * travelers)
      : groundAvailable ? round(85 + miles * 0.36)
      : round((118 + miles * 0.145) * travelers);
  const seasonFactor = destination.bestMonths.includes(date.getUTCMonth() + 1) ? 1.12 : 0.97;
  const rooms = Math.ceil(travelers / 2);
  const lodging = round(destination.nightly * seasonFactor * rooms * (days - 1));
  const other = round(destination.daily * travelers * days);
  const buffer = round((transport + lodging + other) * 0.10);
  const total = transport + lodging + other + buffer;
  return {
    sourceType: 'demo', sourceName: 'TripWise demo distance and city-cost model', isBookable: false,
    mode, miles, groundAvailable, routeKnown: Boolean(rail), routeSource: rail?.source || null,
    timeKnown: false, rooms, nights: days - 1,
    transport, lodging, other, buffer, total, low: round(total * 0.82), high: round(total * 1.28)
  };
}

export function budgetScore(total, budget) {
  const ratio = total / budget;
  if (ratio <= 0.7) return 100;
  if (ratio <= 1) return round(100 - (ratio - 0.7) / 0.3 * 40);
  return round(clamp(60 - (ratio - 1) / 0.3 * 60));
}

const preferenceName = (key) => PREFERENCE_LABELS[key]?.toLowerCase() || key;
const dollars = (amount) => `$${Math.round(amount).toLocaleString('en-US')}`;

/** A UI-safe explanation built only from counts returned by the recommendation engine. */
export function emptyResultExplanation(exclusionCounts, constraints = {}, budgetMode = 'strict') {
  const suggestions = [];
  if (exclusionCounts.overBudget) suggestions.push(budgetMode === 'strict' ? 'Increase the group budget or switch to Flexible Budget to inspect separate stretch options.' : 'Increase the group budget or shorten the trip.');
  if (constraints.noFlights && exclusionCounts.noFlights) suggestions.push('Allow flights or choose a departure city closer to the curated destinations.');
  if (constraints.noCar && exclusionCounts.noCar) suggestions.push('Relax the no-rental-car requirement to include more places.');
  if (constraints.directOnly && exclusionCounts.unverifiedDirect) suggestions.push('Nonstop routes cannot be verified from demo data; remove this limit or check live routes later.');
  if (exclusionCounts.unverifiedGround) suggestions.push('Check an actual rail, coach or road route for nearby places marked route unknown.');
  return suggestions.length ? suggestions.slice(0, 3) : ['Try a different supported departure city or adjust your trip dates.'];
}

export function describeResultState(recommendation) {
  if (recommendation.results.length) return { empty: false };
  if (recommendation.liveMovedOverBudget) return {
    empty: true,
    title: 'No within-budget pick after quote checks.',
    detail: `${recommendation.liveMovedOverBudget} previously modeled pick${recommendation.liveMovedOverBudget === 1 ? '' : 's'} moved to Budget Stretch after source-returned flight and hotel quotes. Other costs remain estimated.`,
    suggestions: ['Raise the group budget, shorten the trip, or inspect separately labeled stretch and unverified options.']
  };
  const { exclusionCounts, emptySuggestions } = recommendation;
  return {
    empty: true,
    title: 'No within-budget, model-feasible destination.',
    detail: `${exclusionCounts.overBudget} exceeded your midpoint budget; ${exclusionCounts.noFlights} need flights in this route model; ${exclusionCounts.noCar} fall below the demo no-car suitability threshold.`,
    suggestions: emptySuggestions
  };
}

function normalizeWeights(weights, emphasizeBudget) {
  const raw = {
    preference: Math.max(0, Number(weights.preference) || 0),
    budget: Math.max(0, Number(weights.budget) || 0) + (emphasizeBudget ? 15 : 0),
    travel: Math.max(0, Number(weights.travel) || 0),
    experience: Math.max(0, Number(weights.experience) || 0)
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (!total) return normalizeWeights(DEFAULT_WEIGHTS, emphasizeBudget);
  const sum = total;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / sum]));
}

/** @param {object} input - A validated search with an origin object and Date. */
export function recommend(input, destinations = DESTINATIONS) {
  const { origin, date, days, travelers, budget, selected = [], styles = [], avoidInterests = [], avoidStyles = [], softPreferences = [], constraints = {}, weights = DEFAULT_WEIGHTS } = input;
  const budgetMode = input.budgetMode === 'flexible' ? 'flexible' : 'strict';
  const effectiveWeights = normalizeWeights(weights, selected.includes('budget'));
  const soft = selected.filter((key) => key !== 'budget');
  const exclusionCounts = { sameCity: 0, noFlights: 0, noCar: 0, unverifiedDirect: 0, unverifiedGround: 0, overBudget: 0, farOverBudget: 0 };
  const feasible = [];
  const stretches = [];
  const needsVerification = [];
  const explore = [];
  for (const destination of destinations) {
    if (milesBetween(origin, destination) < 20) { exclusionCounts.sameCity++; continue; }
    const cost = estimateCost(destination, origin, date, days, travelers, constraints.noFlights);

    const signals = [
      ...soft.map((key) => ({ label: PREFERENCE_LABELS[key] || key, match: destination.tags.includes(key) })),
      ...styles.map((key) => ({ label: STYLE_LABELS[key] || key, match: destination.styles.includes(key) })),
      ...softPreferences.filter((key) => key !== 'direct_flights').map((key) => ({ label: SOFT_LABELS[key] || key, match: key === 'warm_weather' ? destination.tags.includes('warm') : destination.carFree >= 85 }))
    ];
    const matched = soft.filter((key) => destination.tags.includes(key));
    const missing = soft.filter((key) => !destination.tags.includes(key));
    const matchedSignals = signals.filter((signal) => signal.match);
    const avoided = [...avoidInterests.filter((key) => destination.tags.includes(key)), ...avoidStyles.filter((key) => destination.styles.includes(key))];
    const preference = signals.length ? round(clamp(20 + 80 * matchedSignals.length / signals.length - avoided.length * 15)) : 65;
    const budgetFit = budgetScore(cost.total, budget);
    // Distance pressure is a relative planning proxy, not an invented travel time.
    const travelBurden = Math.min(1, cost.miles / (days * 320));
    // Route duration is unknown for every demo option; the base is intentionally provisional.
    const travel = round(clamp(78 - travelBurden * 45 - (cost.mode === 'Flight estimate' ? 10 : 0) - (!cost.routeKnown && cost.groundAvailable ? 8 : 0)));
    const seasonFit = destination.bestMonths.includes(date.getUTCMonth() + 1) ? 90 : 67;
    const durationFit = days >= destination.idealDays[0] && days <= destination.idealDays[1] ? 94 : 67;
    const experience = round(0.45 * seasonFit + 0.35 * durationFit + 0.20 * destination.shortTrip);
    const components = { preference, budget: budgetFit, travel, experience };
    const score = round(Object.entries(components).reduce((sum, [key, value]) => sum + value * effectiveWeights[key], 0));
    const reasons = [];
    if (matchedSignals.length) reasons.push(`Matches ${matchedSignals.slice(0, 2).map((signal) => signal.label.toLowerCase()).join(' and ')} in curated demo tags.`);
    else if (!signals.length) reasons.push('No interests selected; preference fit uses a neutral baseline.');
    if (cost.total <= budget) reasons.push(`Demo midpoint leaves ${dollars(budget - cost.total)} of the group budget.`);
    if (travelBurden < 0.18) reasons.push('The distance proxy suggests a relatively easy short trip.');
    if (seasonFit === 90 && reasons.length < 3) reasons.push('Dates align with its curated favorable season.');
    if (!reasons.length) reasons.push('Trip length fits the curated destination profile.');

    const cautions = [];
    if (cost.total > budget) cautions.push(`Demo midpoint is ${dollars(cost.total - budget)} over budget.`);
    else if (cost.high > budget) cautions.push(`High estimate reaches ${dollars(cost.high)}, ${dollars(cost.high - budget)} above budget.`);
    if (travelBurden >= 0.55) cautions.push('Distance may take a substantial share of a short trip; actual travel time is unknown.');
    if (missing.length) cautions.push(`No demo match for ${missing.slice(0, 2).map(preferenceName).join(' or ')}.`);
    if (avoided.length) cautions.push(`Includes ${avoided.slice(0, 2).join(' or ')}, which you asked to avoid.`);
    if (softPreferences.includes('direct_flights') && cost.mode === 'Flight estimate') cautions.push('Direct flight availability is unknown.');
    if (constraints.noCar) cautions.push('No-car suitability is an editorial demo score; verify local transport.');
    if (seasonFit < 90) cautions.push('Dates are outside its curated favorable season.');
    if (!cautions.length) cautions.push('Actual fares, availability, and local routes are unverified.');

    const blockedFlight = constraints.noFlights && cost.mode === 'Flight estimate';
    const blockedCar = constraints.noCar && destination.carFree < 65;
    const unknownDirect = constraints.directOnly && cost.mode === 'Flight estimate';
    const unknownGround = !cost.routeKnown && cost.groundAvailable;
    const budgetDifference = budget - cost.total;
    const priceRisk = cost.total > budget ? 'over-midpoint' : cost.high > budget ? 'upper-range-over' : 'within-range';
    const item = {
      ...destination, cost, score, components, matched, missing,
      preferenceMatch: { matched: matchedSignals.length, requested: signals.length, score: signals.length ? round(matchedSignals.length / signals.length * 100) : 65, labels: matchedSignals.map((signal) => signal.label) },
      dataConfidence: { level: cost.routeKnown ? (constraints.noCar ? 'Provisional' : 'Partial') : 'Low', reason: cost.routeKnown ? 'Rail corridor is sourced; date, fare, duration and local mobility are not verified.' : 'Route availability, fare and duration are not verified in this demo.' },
      travelBurden, reasons: reasons.slice(0, 3), cautions: cautions.slice(0, 3),
      drawback: cautions[0], overBudget: budgetDifference < 0, budgetDifference, priceRisk,
      status: 'feasible', feasibilityNote: constraints.noCar
        ? 'Rail corridor exists; local no-car fit is an editorial demo score.'
        : cost.routeKnown ? 'Rail corridor exists; date, service and fare still need checking.'
          : 'Feasible only within the demo model; routes and prices are unverified.'
    };

    if (blockedFlight || blockedCar) {
      if (blockedFlight) exclusionCounts.noFlights++;
      if (blockedCar) exclusionCounts.noCar++;
      item.status = 'excluded';
      item.feasibilityNote = blockedFlight ? 'This demo option needs a flight; No Flights blocks it.' : 'No-car suitability is below the demo threshold.';
      item.exploreReason = item.feasibilityNote;
      explore.push(item);
      continue;
    }

    if (unknownDirect || unknownGround) {
      if (unknownDirect) exclusionCounts.unverifiedDirect++;
      if (unknownGround) exclusionCounts.unverifiedGround++;
      item.status = 'unverified';
      item.feasibilityNote = unknownDirect
        ? 'Nonstop flight availability cannot be verified from demo distance data.'
        : 'Ground route availability is unknown for this origin–destination pair.';
      item.exploreReason = item.feasibilityNote;
      needsVerification.push(item);
      continue;
    }

    if (budgetDifference < 0) {
      exclusionCounts.overBudget++;
      if (cost.total > budget * (budgetMode === 'flexible' ? 1.25 : 1.15) || (signals.length && !matchedSignals.length)) {
        exclusionCounts.farOverBudget++;
        item.status = 'excluded';
        item.exploreReason = `Demo midpoint is ${dollars(-budgetDifference)} over budget${signals.length && !matchedSignals.length ? ' and no selected preference matches' : ''}.`;
        explore.push(item);
        continue;
      }
      item.status = 'stretch';
      item.feasibilityNote = `Not within the ${dollars(budget)} group budget at the demo midpoint.`;
      const shorter = days > 2 ? estimateCost(destination, origin, date, days - 1, travelers, constraints.noFlights) : null;
      item.stretchAdjustment = shorter && shorter.total <= budget
        ? `A ${days - 1}-day demo plan is ${dollars(shorter.total)}; check whether it suits you.`
        : `Raise the group budget by at least ${dollars(-budgetDifference)} at the demo midpoint.`;
      stretches.push(item);
      continue;
    }
    feasible.push(item);
  }
  const sort = (a, b) => b.score - a.score || a.cost.total - b.cost.total;
  feasible.sort(sort);
  stretches.sort((a, b) => b.preferenceMatch.score - a.preferenceMatch.score || a.cost.total - b.cost.total || b.score - a.score);
  needsVerification.sort(sort);
  explore.sort(sort);
  const primary = feasible.slice(0, 5);
  const stretchPrimary = stretches.slice(0, budgetMode === 'flexible' ? 3 : 2);
  const verificationPrimary = needsVerification.slice(0, 3);
  const remaining = [
    ...feasible.slice(5).map((item) => ({ ...item, exploreReason: 'Eligible, but scored below the five best fits.' })),
    ...stretches.slice(stretchPrimary.length).map((item) => ({ ...item, exploreReason: 'Budget Stretch candidate below the displayed shortlist.' })),
    ...needsVerification.slice(3), ...explore
  ];
  remaining.sort(sort);
  return {
    results: primary, stretches: stretchPrimary, needsVerification: verificationPrimary, explore: remaining,
    totalCandidates: feasible.length, exclusionCounts, effectiveWeights, budgetMode,
    emptySuggestions: emptyResultExplanation(exclusionCounts, constraints, budgetMode)
  };
}
