import { budgetScore } from './engine.js';

const clamp = (value) => Math.max(0, Math.min(100, value));
const all = (recommendation) => [...recommendation.results, ...recommendation.stretches, ...recommendation.needsVerification, ...recommendation.explore];

/** Re-score quote-supported candidates without promoting a hard-limit violation. */
export function mergeLiveQuotes(base, quotes, search) {
  const byId = new Map(Object.entries(quotes || {}));
  const updated = all(base).map((item) => {
    const live = byId.get(item.id);
    if (!live?.estimate || !['live', 'cached'].includes(live.status) || !['feasible', 'stretch', 'unverified'].includes(item.status) || search.constraints?.noFlights) return { ...item, live: live || null };
    const total = live.estimate.midpoint;
    const budget = budgetScore(total, search.budget);
    const duration = (live.flight?.outbound?.durationMinutes || 0) + (live.flight?.returning?.durationMinutes || 0);
    const travel = duration ? Math.round(clamp(78 - duration / (search.days * 1440) * 85 - ((live.flight?.outbound?.layovers || 0) + (live.flight?.returning?.layovers || 0)) * 6)) : item.components.travel;
    const components = { ...item.components, budget, travel };
    const score = Math.round(Object.entries(components).reduce((sum, [key, value]) => sum + value * base.effectiveWeights[key], 0));
    const overBudget = total > search.budget;
    return { ...item, live, components, score, status: overBudget ? 'stretch' : 'feasible', overBudget, budgetDifference: search.budget - total,
      dataConfidence: { level: 'Quote-supported · partial', reason: 'Selected flight and hotel quotes came from API results; local spending and buffer are estimated.' },
      feasibilityNote: overBudget ? `Quote-supported midpoint exceeds your group cap by $${Math.round(total - search.budget).toLocaleString()}.` : 'Quote-supported midpoint fits; local spending remains estimated.',
      reasons: [...item.reasons.filter((reason) => !reason.startsWith('Demo midpoint')), `Selected flight + hotel quotes inform the budget score; local expenses remain estimated.`].slice(0, 3),
      cautions: [...(overBudget ? [`Quote-supported midpoint is $${Math.round(total - search.budget).toLocaleString()} over budget.`] : live.estimate.high > search.budget ? [`Estimated high end exceeds budget by $${Math.round(live.estimate.high - search.budget).toLocaleString()}.`] : []), ...item.cautions.filter((note) => !note.startsWith('Demo midpoint') && !note.startsWith('High estimate'))].slice(0, 3) };
  });
  const sort = (a, b) => b.score - a.score;
  const feasible = updated.filter((item) => item.status === 'feasible').sort(sort);
  const stretch = updated.filter((item) => item.status === 'stretch').sort((a, b) => b.preferenceMatch.score - a.preferenceMatch.score || b.score - a.score);
  const unverified = updated.filter((item) => item.status === 'unverified').sort(sort);
  const excluded = updated.filter((item) => item.status === 'excluded').sort(sort);
  const stretchLimit = search.budgetMode === 'flexible' ? 3 : 2;
  return { ...base, results: feasible.slice(0, 5), stretches: stretch.slice(0, stretchLimit), needsVerification: unverified.slice(0, 3),
    explore: [...feasible.slice(5), ...stretch.slice(stretchLimit), ...unverified.slice(3), ...excluded].sort(sort), totalCandidates: feasible.length,
    liveMovedOverBudget: updated.filter((item) => item.live?.estimate && item.status === 'stretch' && base.results.some((before) => before.id === item.id)).length,
    liveUpdated: updated.some((item) => item.live?.estimate && ['live','cached'].includes(item.live.status)) };
}
