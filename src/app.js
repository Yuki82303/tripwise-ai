import { DESTINATIONS, ORIGINS, PREFERENCE_LABELS, STYLE_LABELS, SOFT_LABELS, SPENDING_LABELS } from './data.js';
import { DEFAULT_WEIGHTS, describeResultState, parsePreferences, recommend, resolveOrigin, validateSearch } from './engine.js';
import { destinationEvidence, SOURCE_TYPES } from './sources.js';
import { mergeLiveQuotes } from './live.js';

const app = document.querySelector('#app');
const tomorrow = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
const state = {
  input: { origin: 'New York, NY', budget: '1200', budgetMode: 'strict', date: tomorrow, days: '3', travelers: '2', text: 'Great food, city energy, no rental car' },
  overrides: {}, weights: { ...DEFAULT_WEIGHTS }, validation: null, search: null, results: null,
  selectedCompare: [], loading: false, exploreOpen: false, expandedExplore: [], rankChanges: {}, lastWeightChanged: '',
  aiAvailable: false, aiMode: 'demo-only', aiLoading: false, aiError: '', aiDiagnostic: '', analysis: null, aiConfirmed: false, aiFormSnapshot: null, preferenceMode: 'demo', communityCache: {}, weatherCache: {},
  serpConfigured: false, serpVerified: false, geminiVerified: false, liveQuotes: {}, liveLoading: false, liveError: '', livePhase: '', liveCardStates: {}, liveUsage: null, discussions: {}, discussionLoading: {}, discussionErrors: {}, weightFeedback: '', searchRevision: 0
};
const communityPending = new Map();
const weatherPending = new Map();

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const icon = (name, size = 18) => {
  const paths = {
    spark: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="m19 17 .5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17Z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    plane: '<path d="m21 3-8 18-2.5-7.5L3 11l18-8Z"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-14a4 4 0 0 1 0 8m6 6v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="m4 12 5 5L20 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>', close: '<path d="M5 5 19 19M19 5 5 19"/>',
    sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/>',
    suitcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M8 18h.01M16 18h.01"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
};

const photo = (item, className = '') => `<div class="photo-shell ${className} ${item.photo ? '' : 'illustrated-place'}">
  <div class="photo-fallback"><span>${esc(item.city)}</span><small>${item.photo ? 'Destination photo unavailable' : 'Illustrated demo preview · no destination photo'}</small></div>
  ${item.photo ? `<img src="${esc(item.photo.localUrl || item.photo.url)}" ${item.photo.localUrl ? `data-remote-src="${esc(item.photo.url)}"` : ''} alt="${esc(item.photo.subject)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}
</div>`;

function resolvedPreferences() {
  const parsed = parsePreferences(state.input.text);
  const ai = state.preferenceMode === 'ai' ? state.analysis?.analysis : null;
  const selected = Object.keys(PREFERENCE_LABELS).filter((key) => state.overrides[`pref:${key}`] ?? (ai ? ai.interests.includes(key) : parsed.selected.includes(key)));
  const constraints = Object.fromEntries(Object.keys(parsed.constraints).map((key) => [key, state.overrides[`constraint:${key}`] ?? (ai ? ai.hardConstraints[key] : parsed.constraints[key])]));
  const pick = (labels, field, base) => Object.keys(labels).filter((key) => state.overrides[`${field}:${key}`] ?? base?.includes(key));
  return { selected, constraints, styles: pick(STYLE_LABELS, 'style', ai?.styles || parsed.styles), avoidInterests: pick(PREFERENCE_LABELS, 'avoidinterest', ai?.avoidInterests || parsed.avoidInterests), avoidStyles: pick(STYLE_LABELS, 'avoidstyle', ai?.avoidStyles || parsed.avoidStyles), softPreferences: pick(SOFT_LABELS, 'soft', ai?.softPreferences || parsed.softPreferences), spendingPriorities: pick(SPENDING_LABELS, 'spending', ai?.spendingPriorities || parsed.spendingPriorities), source: ai ? state.analysis.source : 'Demo Rule-based Matching' };
}

function preferencePanel() {
  const current = resolvedPreferences();
  const parsedLocal = parsePreferences(state.input.text);
  const prefChips = Object.entries(PREFERENCE_LABELS).map(([key, label]) => `<button type="button" class="chip ${current.selected.includes(key) ? 'active' : ''}" data-pref="${key}" aria-pressed="${current.selected.includes(key)}">${current.selected.includes(key) ? icon('check', 13) : ''}${label}</button>`).join('');
  const constraints = [['noFlights', 'No flights'], ['noCar', 'No rental car'], ['directOnly', 'No layovers']]
    .map(([key, label]) => `<button type="button" class="chip constraint ${current.constraints[key] ? 'active' : ''}" data-constraint="${key}" aria-pressed="${current.constraints[key]}">${current.constraints[key] ? icon('check', 13) : ''}${label}</button>`).join('');
  const chips = (labels, values, attr) => Object.entries(labels).map(([key, label]) => `<button type="button" class="chip ${values.includes(key) ? 'active' : ''}" data-${attr}="${key}" aria-pressed="${values.includes(key)}">${values.includes(key) ? icon('check', 13) : ''}${label}</button>`).join('');
  const analysis = state.preferenceMode === 'ai' ? state.analysis : null;
  const aiExplanation = analysis?.analysis?.explanation ? `<p class="ai-explanation">${esc(analysis.analysis.explanation)}${analysis.analysis.priorityWeights ? ` Suggested weights applied: budget ${analysis.analysis.priorityWeights.budget} · travel ${analysis.analysis.priorityWeights.travel} · experiences ${analysis.analysis.priorityWeights.experience}. You can edit every slider.` : ''}</p>` : '';
  return `<div class="match-heading"><span class="demo-dot"></span> ${esc(current.source)} <span class="match-help">${analysis ? 'Structured output · manual tag choices take precedence' : 'Local keywords · edit tags below'}</span></div>
    ${aiExplanation}
    <div class="chip-list">${prefChips}</div><div class="constraint-list">${constraints}</div>${!analysis && parsedLocal.budgetIntent !== 'unspecified' && parsedLocal.budgetIntent !== state.input.budgetMode ? `<p class="form-intent-note">Your note sounds ${esc(parsedLocal.budgetIntent)}, while the form is ${esc(state.input.budgetMode)}. The form controls your budget limit.</p>` : ''}
    ${analysis ? `<div class="ai-detail"><strong>Travel style</strong><div class="chip-list">${chips(STYLE_LABELS, current.styles, 'style')}</div><strong>Interests to avoid</strong><div class="chip-list">${chips(PREFERENCE_LABELS, current.avoidInterests, 'avoidinterest')}</div><strong>Styles to avoid</strong><div class="chip-list">${chips(STYLE_LABELS, current.avoidStyles, 'avoidstyle')}</div><strong>Soft preferences</strong><div class="chip-list">${chips(SOFT_LABELS, current.softPreferences, 'soft')}</div><strong>Spending priorities</strong><div class="chip-list">${chips(SPENDING_LABELS, current.spendingPriorities, 'spending')}</div><small>Spending priorities are captured for planning, but do not change scores without verified quality data.</small>${analysis.analysis.ambiguities.length ? `<p>Needs clarification: ${esc(analysis.analysis.ambiguities.join(' · '))}</p>` : ''}${analysis.conflicts.length ? `<div class="ai-conflicts"><strong>Check form conflicts</strong>${analysis.conflicts.map((x) => `<p>${esc(x)}</p>`).join('')}<button type="button" id="confirm-ai-conflicts">${state.aiConfirmed ? 'Confirmed: use form values' : 'Confirm: use form values'}</button></div>` : ''}</div>` : `<details class="local-extras"><summary>Refine style, soft wishes & spending priorities</summary><div class="ai-detail"><strong>Travel style</strong><div class="chip-list">${chips(STYLE_LABELS, current.styles, 'style')}</div><strong>Interests to avoid</strong><div class="chip-list">${chips(PREFERENCE_LABELS, current.avoidInterests, 'avoidinterest')}</div><strong>Soft preferences</strong><div class="chip-list">${chips(SOFT_LABELS, current.softPreferences, 'soft')}</div><strong>Spending priorities</strong><div class="chip-list">${chips(SPENDING_LABELS, current.spendingPriorities, 'spending')}</div><small>Local rules are limited. Spending priorities are shown for planning, not scored.</small></div></details>`}
    ${state.aiError ? `<p class="ai-error" role="alert">${esc(state.aiError)}</p>${state.aiDiagnostic ? `<details class="ai-error-detail"><summary>Technical details</summary><small>${esc(state.aiDiagnostic)}</small></details>` : ''}` : ''}`;
}

function inputError(key) { return state.validation?.errors?.[key] ? `<p class="field-error" role="alert">${esc(state.validation.errors[key])}</p>` : ''; }

function renderShell() {
  const miami = DESTINATIONS[0], portland = DESTINATIONS[9], newOrleans = DESTINATIONS[2];
  app.innerHTML = `
    <header class="site-header"><div class="wrap nav-row"><a class="brand" href="#top" aria-label="TripWise AI home"><span class="brand-icon">${icon('compass', 22)}</span><span>tripwise<span class="brand-accent">.</span><small>AI</small></span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#plan">Plan a trip</a><a href="#about">About the demo</a></nav><a class="nav-cta" href="#plan">Find your trip ${icon('arrow', 16)}</a></div></header>
    <main id="top"><section class="hero wrap"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span> THE SMARTER WAY TO GET AWAY</div><h1>Go somewhere<br /><em>that makes sense.</em></h1><p class="hero-lead">The best trip isn't always the farthest one. Find US destinations that fit your budget, your time, and your kind of good time.</p><div class="hero-actions"><a class="button button-primary" href="#plan">Find my next trip ${icon('arrow', 18)}</a><span class="hero-reassurance">${icon('spark', 17)} Thoughtful picks. Clear trade-offs.</span></div><div class="hero-proof"><span class="proof-number">${DESTINATIONS.length}</span><span>curated US destinations</span><span class="proof-divider"></span><span class="proof-number">4</span><span>transparent score factors</span></div></div>
      <div class="hero-art" aria-label="Travel inspiration photos"><div class="hero-large">${photo(miami, 'hero-photo')}<div class="hero-photo-label"><span>01 / COASTAL ESCAPES</span><strong>Miami, Florida</strong><a href="${esc(miami.photo.source)}" target="_blank" rel="noopener noreferrer">Photo: ${esc(miami.photo.credit)} · ${esc(miami.photo.license)} ↗</a></div></div><div class="hero-small">${photo(portland, 'hero-photo')}<div class="small-photo-label">Portland, Maine<a href="${esc(portland.photo.source)}" target="_blank" rel="noopener noreferrer">Photo source ↗</a></div></div><div class="floating-note"><span class="floating-icon">${icon('suitcase', 19)}</span><div><strong>Better-fit escapes</strong><small>Built around your actual plans</small></div></div></div></section>
      <section class="planner-section" id="plan"><div class="wrap"><div class="section-kicker">LET'S GET GOING</div><div class="section-heading"><div><h2>Your next trip starts here.</h2><p>Tell us the basics. We'll show the trade-offs.</p></div><div class="section-side-note">No account. No hidden booking links.<br />Just a clearer place to start.</div></div>
      <form id="search-form" class="search-card" novalidate><div class="form-main-grid"><div class="field field-origin"><label for="origin">${icon('pin', 17)} Departing from</label><input id="origin" name="origin" list="origins" autocomplete="off" value="${esc(state.input.origin)}" placeholder="Choose a US city" aria-describedby="origin-hint" /><datalist id="origins">${ORIGINS.map((o) => `<option value="${esc(o.name)}"></option>`).join('')}</datalist><small id="origin-hint">6 supported cities in this demo</small>${inputError('origin')}</div>
      <div class="field"><label for="budget">${icon('spark', 17)} Total budget</label><div class="input-prefix"><span>$</span><input id="budget" name="budget" type="number" min="100" max="30000" step="50" value="${esc(state.input.budget)}" /></div><small>USD for everyone, entire trip</small>${inputError('budget')}</div>
      <div class="field"><label for="date">${icon('calendar', 17)} Departure date</label><input id="date" name="date" type="date" value="${esc(state.input.date)}" min="${new Date().toISOString().slice(0, 10)}" />${inputError('date')}</div>
      <div class="field"><label for="days">${icon('clock', 17)} Trip length</label><select id="days" name="days">${[2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(state.input.days) === d ? 'selected' : ''}>${d} days</option>`).join('')}</select>${inputError('days')}</div>
      <div class="field"><label for="travelers">${icon('users', 17)} Travelers</label><select id="travelers" name="travelers">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(state.input.travelers) === n ? 'selected' : ''}>${n} ${n === 1 ? 'person' : 'people'}</option>`).join('')}</select>${inputError('travelers')}</div></div>
      <div class="budget-mode-row"><div><strong>How firm is your budget?</strong><small>Strict keeps over-budget places out of feasible results.</small></div><div class="budget-mode-control"><label><input type="radio" name="budgetMode" value="strict" ${state.input.budgetMode !== 'flexible' ? 'checked' : ''} /><span>Strict limit</span></label><label><input type="radio" name="budgetMode" value="flexible" ${state.input.budgetMode === 'flexible' ? 'checked' : ''} /><span>Flexible Budget</span></label></div></div>
      <div class="preference-area"><div class="preference-copy"><label for="preferences">What's your kind of trip?</label><small>Describe your interests, travel style, priorities, and hard limits.</small></div><textarea id="preferences" name="text" rows="2" maxlength="500" placeholder="I want a quiet food weekend, no rental car, and would spend more on experiences...">${esc(state.input.text)}</textarea>${inputError('text')}<div class="ai-actions"><button type="button" id="analyze-ai" ${state.aiAvailable && !state.aiLoading ? '' : 'disabled'}>${state.aiLoading ? '<span class="spinner"></span> Analyzing…' : `${icon('spark', 15)} Analyze with AI`}</button><button type="button" id="use-demo">Use local demo</button><span>${state.aiAvailable ? (state.aiMode === 'local-ollama' ? 'Local Ollama ready · runs only when clicked' : state.aiMode === 'gemini-configured' ? state.geminiVerified ? 'Gemini connected this session' : 'Gemini configured · click to verify access' : 'Cloud AI configured · runs only when clicked') : 'Local rules ready · AI optional'}</span></div><div id="preference-panel">${preferencePanel()}</div></div>
      <div class="form-footer"><div class="estimate-disclaimer">${icon('info', 17)} Initial results use modeled prices; optional live quotes are separate.</div><button id="submit-button" class="button button-primary" type="submit">Show my best matches ${icon('arrow', 18)}</button></div></form></div></section>
      <section id="results" class="results-section wrap" aria-live="polite"></section>
      <section class="how-section" id="how-it-works"><div class="wrap"><div class="section-kicker">WHY TRIPWISE</div><h2>A little more clarity.<br /><em>A lot more possibility.</em></h2><div class="how-grid"><article><span>01</span><div class="how-icon">${icon('sliders', 24)}</div><h3>Tell us what matters</h3><p>Budget, time, travel companions, and the little things that make a getaway yours.</p></article><article><span>02</span><div class="how-icon">${icon('compass', 24)}</div><h3>See the reasoning</h3><p>Every recommendation comes with a clear score breakdown and honest trade-offs.</p></article><article><span>03</span><div class="how-icon">${icon('compare', 24)}</div><h3>Compare with confidence</h3><p>Put places side by side and decide where your time and money go further.</p></article></div></div></section>
      <section class="closing-section wrap" id="about"><div><div class="section-kicker">MADE FOR CURIOUS TRAVELERS</div><h2>Less guessing.<br />More going.</h2><p>TripWise AI is an interactive portfolio demo. Optional AI analysis only extracts preferences; local algorithms still calculate demo costs and rank destinations. Initial prices remain modeled. Source-linked live quotes and public discussion previews appear only after you request them.</p><a class="text-link" href="#plan">Plan another trip ${icon('arrow', 17)}</a></div><div class="closing-image">${photo(newOrleans)}<span>New Orleans, Louisiana <a href="${esc(newOrleans.photo.source)}" target="_blank" rel="noopener noreferrer">Photo: ${esc(newOrleans.photo.credit)} · ${esc(newOrleans.photo.license)} ↗</a></span></div></section></main>
    <footer><div class="wrap footer-row"><a class="brand" href="#top"><span class="brand-icon">${icon('compass', 19)}</span><span>tripwise<span class="brand-accent">.</span><small>AI</small></span></a><span>Go somewhere that makes sense.</span><span>© ${new Date().getFullYear()} TripWise AI · Portfolio demo</span></div></footer>`;
  bindForm();
  wireImageFallbacks();
  if (state.search) renderResults();
}

function syncExistingResults() {
  if (!state.search || (state.preferenceMode === 'ai' && state.analysis?.conflicts?.length && !state.aiConfirmed)) return;
  const validation = validateSearch(state.input);
  if (!validation.valid) return;
  const prior = state.search;
  const sameTrip = prior.origin.id === validation.origin.id && prior.date.toISOString() === validation.date.toISOString() && prior.days === validation.days && prior.travelers === validation.travelers;
  if (!sameTrip) { state.liveQuotes = {}; state.liveCardStates = {}; state.discussions = {}; state.discussionErrors = {}; state.searchRevision++; }
  state.search = { ...validation, ...resolvedPreferences(), budgetMode: state.input.budgetMode, weights: state.weights };
  state.results = mergeLiveQuotes(recommend(state.search), state.liveQuotes, state.search);
  state.rankChanges = {}; state.weightFeedback = '';
  renderResults();
}

function bindForm() {
  const form = document.querySelector('#search-form');
  const showPanel = () => { document.querySelector('#preference-panel').innerHTML = preferencePanel(); };
  form.addEventListener('input', (event) => {
    if (event.target.name) state.input[event.target.name] = event.target.value;
    if (event.target.name && state.analysis) {
      state.analysis = null; state.preferenceMode = 'demo'; state.aiConfirmed = false; state.overrides = {};
      state.aiError = 'Travel inputs changed. AI analysis was cleared; analyze again to use AI.';
    }
    if (event.target.id === 'preferences' || state.aiError) showPanel();
  });
  form.addEventListener('change', (event) => { if (event.target.name) state.input[event.target.name] = event.target.value; });
  form.addEventListener('click', (event) => {
    const pref = event.target.closest('[data-pref]');
    const constraint = event.target.closest('[data-constraint]');
    const style = event.target.closest('[data-style]');
    const soft = event.target.closest('[data-soft]');
    const spending = event.target.closest('[data-spending]');
    const avoidInterest = event.target.closest('[data-avoidinterest]');
    const avoidStyle = event.target.closest('[data-avoidstyle]');
    if (pref) {
      const current = resolvedPreferences();
      state.overrides[`pref:${pref.dataset.pref}`] = !current.selected.includes(pref.dataset.pref);
      showPanel();
    }
    if (constraint) {
      const current = resolvedPreferences();
      state.overrides[`constraint:${constraint.dataset.constraint}`] = !current.constraints[constraint.dataset.constraint];
      showPanel();
    }
    for (const [button, field, values] of [[style,'style','styles'],[soft,'soft','softPreferences'],[spending,'spending','spendingPriorities'],[avoidInterest,'avoidinterest','avoidInterests'],[avoidStyle,'avoidstyle','avoidStyles']]) if (button) {
      const key = button.dataset[field];
      state.overrides[`${field}:${key}`] = !resolvedPreferences()[values].includes(key);
      showPanel();
    }
    if (event.target.closest('#confirm-ai-conflicts')) { state.aiConfirmed = true; state.aiError = ''; state.aiDiagnostic = ''; showPanel(); syncExistingResults(); }
  });
  form.querySelector('#use-demo').addEventListener('click', () => {
    state.preferenceMode = 'demo'; state.analysis = null; state.aiConfirmed = false; state.aiError = ''; state.aiDiagnostic = ''; state.overrides = {}; showPanel(); syncExistingResults();
  });
  form.querySelector('#analyze-ai').addEventListener('click', async () => {
    state.input = Object.fromEntries(new FormData(form).entries());
    state.validation = validateSearch(state.input);
    if (!state.validation.valid) { renderShell(); return; }
    if (!state.input.text?.trim() || state.input.text.trim().length < 3) { state.aiError = 'Enter at least three characters before AI analysis.'; showPanel(); return; }
    state.aiLoading = true; state.aiError = ''; state.aiDiagnostic = '';
    const submittedInput = JSON.stringify(state.input);
    const button = form.querySelector('#analyze-ai');
    button.disabled = true; button.innerHTML = '<span class="spinner"></span> Analyzing…';
    try {
      const response = await fetch('/api/preferences/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: state.input.text, form: state.input }), signal: AbortSignal.timeout(state.aiMode === 'local-ollama' ? 26000 : 16000) });
      const value = await response.json();
      if (JSON.stringify(Object.fromEntries(new FormData(form).entries())) !== submittedInput) throw new Error('Travel inputs changed during analysis. Analyze again.');
      if (!response.ok) {
        const detail = value.diagnostic;
        const context = detail ? ` [${detail.stage || 'Gemini'} · ${detail.model || 'model not selected'} · HTTP ${detail.httpStatus || 'unknown'}${detail.upstreamStatus ? ` · ${detail.upstreamStatus}` : ''}]` : '';
        const issue = new Error(value.message || 'AI analysis failed.');
        issue.code = value.error;
        issue.diagnostic = detail;
        issue.context = `${context}${detail?.upstreamMessage ? ` Google: ${detail.upstreamMessage}` : ''}${detail?.upstreamReason ? ` Reason: ${detail.upstreamReason}` : ''}`;
        throw issue;
      }
      state.analysis = value; state.preferenceMode = 'ai'; state.aiConfirmed = false;
      if (value.mode === 'gemini') state.geminiVerified = true;
      if (value.analysis?.priorityWeights) state.weights = { ...value.analysis.priorityWeights };
    } catch (error) {
      state.analysis = null; state.preferenceMode = 'demo';
      const status = error?.diagnostic?.httpStatus;
      const providerName = state.aiMode === 'gemini-configured' ? 'Gemini' : 'AI';
      state.aiError = `${status === 400 ? `${providerName} rejected the analysis format (400).` : status === 401 ? `${providerName} rejected the API credential (401).` : status === 403 ? `${providerName} access is denied for this key (403).` : status === 429 ? `${providerName} rate or free-tier limit was reached (429).` : error?.name === 'TimeoutError' || error?.code === 'timeout' ? `${providerName} timed out.` : `${providerName} analysis is unavailable.`} Using Demo Rule-based Matching.`;
      state.aiDiagnostic = `${error?.message || ''}${error?.context || ''}`.slice(0, 600);
    } finally {
      state.aiLoading = false; button.disabled = !state.aiAvailable; button.innerHTML = `${icon('spark', 15)} Analyze with AI`; showPanel(); syncExistingResults();
      if (state.geminiVerified) form.querySelector('.ai-actions span:last-child').textContent = 'Gemini connected this session';
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.input = Object.fromEntries(new FormData(form).entries());
    state.validation = validateSearch(state.input);
    if (!state.validation.valid) { renderShell(); document.querySelector('#search-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (state.preferenceMode === 'ai' && state.analysis?.conflicts?.length && !state.aiConfirmed) { state.aiError = 'Confirm the form conflicts above before generating results.'; showPanel(); return; }
    state.loading = true;
    const button = document.querySelector('#submit-button');
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> Finding your matches…`;
    await new Promise((resolve) => setTimeout(resolve, 330));
    const prefs = resolvedPreferences();
    state.search = { ...state.validation, ...prefs, budgetMode: state.input.budgetMode, weights: state.weights };
    state.searchRevision++; state.liveQuotes = {}; state.liveError = ''; state.livePhase = ''; state.liveCardStates = {}; state.weightFeedback = ''; state.discussions = {}; state.discussionErrors = {};
    state.results = recommend(state.search);
    state.rankChanges = {}; state.lastWeightChanged = '';
    state.expandedExplore = [];
    state.selectedCompare = [];
    state.loading = false;
    button.disabled = false;
    button.innerHTML = `Update my matches ${icon('arrow', 18)}`;
    renderResults();
    document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function wireImageFallbacks() {
  document.querySelectorAll('.photo-shell img').forEach((img) => img.addEventListener('error', () => {
    if (img.dataset.remoteSrc) {
      img.src = img.dataset.remoteSrc;
      delete img.dataset.remoteSrc;
      return;
    }
    img.style.display = 'none';
    img.closest('.photo-shell')?.classList.add('illustrated-place');
    img.closest('.result-photo, .hero-large, .hero-small, .closing-image')?.querySelector('.photo-source, .hero-photo-label a, .small-photo-label a, .closing-image a')?.setAttribute('hidden', '');
  }));
}

function dateLine() {
  const { date, days, travelers, origin, budget, budgetMode } = state.search;
  return `${origin.name} · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${days} days · ${travelers} ${travelers === 1 ? 'traveler' : 'travelers'} · ${money(budget)} group budget · ${budgetMode === 'flexible' ? 'Flexible' : 'Strict'} limit`;
}

function scoreRing(score) { return `<div class="score-ring" style="--score:${score}"><strong>${score}</strong><small>/100</small></div>`; }

const weightLabels = { preference: 'Preference Fit', budget: 'Budget Fit', travel: 'Travel Ease', experience: 'Trip Experience' };
function weightPercentages(weights) {
  const entries = Object.entries(weights).map(([key, value]) => ({ key, exact: value * 100, whole: Math.floor(value * 100) }));
  let remaining = 100 - entries.reduce((sum, entry) => sum + entry.whole, 0);
  for (const entry of [...entries].sort((a, b) => (b.exact - b.whole) - (a.exact - a.whole))) if (remaining-- > 0) entry.whole++;
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.whole]));
}
function rankingNote(item) {
  const driver = Object.entries(item.components).map(([key, score]) => ({ key, points: score * state.results.effectiveWeights[key] })).sort((a, b) => b.points - a.points)[0];
  const change = state.rankChanges[item.id];
  const movement = change?.priorRank && change.priorRank !== change.rank
    ? `Moved ${change.priorRank > change.rank ? 'up' : 'down'} ${Math.abs(change.priorRank - change.rank)} place${Math.abs(change.priorRank - change.rank) === 1 ? '' : 's'} after ${state.lastWeightChanged} changed. `
    : change?.priorRank === 0 ? `Entered the top picks after ${state.lastWeightChanged} changed. `
      : change?.scoreDelta ? `Score ${change.scoreDelta > 0 ? '+' : ''}${change.scoreDelta} after ${state.lastWeightChanged} changed. ` : '';
  const changeDetail = change?.beforeScore !== undefined ? ` ${change.beforeScore} → ${item.score} points; ${weightLabels[driver.key]} contributes ${Math.round(driver.points)} now${change.beforeContribution !== undefined ? ` versus ${change.beforeContribution} before` : ''}.` : '';
  return `${movement}${changeDetail || `Largest weighted contribution: ${weightLabels[driver.key]} (${Math.round(driver.points)} of ${item.score} points).`}`;
}

const evidenceTag = (type, text = SOURCE_TYPES[type]?.label || type) => `<span class="source-badge ${esc(type)}" title="${esc(SOURCE_TYPES[type]?.description || '')}">${esc(text)}</span>`;
function livePriceSection(item) {
  const quote = state.liveQuotes[item.id];
  if (!quote) return `<div class="memo-card live-note"><h4>Live Travel Prices ${evidenceTag('provisional', 'Not checked')}</h4><p>Click “Check Live Prices” above to request quotes for the first two picks. Card prices remain separate modeled estimates.</p></div>`;
  const flight = quote.flight, hotel = quote.hotel;
  const part = (label, value) => {
    if (!value?.farePerTraveler && !value?.totalStay) return `<p><strong>${label}:</strong> Unavailable. ${esc(value?.reason || 'No complete quote.')}</p>`;
    const detail = label === 'Flight'
      ? `${money(value.farePerTraveler)} API-returned round-trip price · ${value.groupFare ? `${money(value.groupFare)} for one traveler` : `group total unknown; ${money(value.groupFareEstimate)} provisional multiplication for ${value.travelers} travelers`} · ${esc(value.outbound.airline)} · ${esc(value.outbound.departureAirport)} → ${esc(value.outbound.arrivalAirport)} ${esc(value.outbound.departureAt?.slice(0, 10))}, return ${esc(value.returning.departureAt?.slice(0, 10))} · ${value.outbound.durationMinutes + value.returning.durationMinutes} min air itinerary · ${value.outbound.layovers + value.returning.layovers} layovers · final taxes, fees and booking availability unverified`
      : `${money(value.totalStay)} full stay · ${esc(value.hotel)} · ${esc(value.checkIn)} → ${esc(value.checkOut)} · ${value.nights} nights · ${value.travelers} guest${value.travelers === 1 ? '' : 's'}${value.provider ? ` · ${esc(value.provider)}` : ''}${value.taxesIncluded === true ? ' · total exceeds displayed pre-tax rate; final fees unverified' : ' · tax/fee inclusion unknown'}`;
    return `<p><strong>${label}:</strong> ${detail}. ${value.sourceUrl ? `<a href="${esc(value.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(value.source)} ↗</a>` : `<span>${esc(value.source)} · direct quote link unavailable</span>`}<small>${value.status === 'cached' ? 'Cached Price' : 'Live Price'} · checked ${esc(new Date(value.checkedAt).toLocaleString('en-US'))}</small></p>`;
  };
  return `<div class="memo-card live-note"><h4>Live Travel Prices ${evidenceTag(quote.status === 'unverified' ? 'provisional' : quote.status === 'cached' ? 'cached' : 'live', quote.status === 'unverified' ? 'Partial Live Quote' : quote.status === 'cached' ? 'Cached flight + hotel' : 'Matched live flight + hotel')}</h4>${part('Flight', flight)}${part('Hotel', hotel)}${quote.transportMode === 'rail' ? `<p><strong>Rail:</strong> Fare and schedule unknown. ${quote.railOperatorUrl ? `<a href="${esc(quote.railOperatorUrl)}" target="_blank" rel="noopener noreferrer">Check operator ↗</a>` : 'Check the operator before booking.'}</p>` : ''}${quote.estimate ? `<p><strong>Quote-supported transport + hotel:</strong> ${money(quote.verifiedCosts)} for the confirmed traveler count. <strong>Estimated expenses:</strong> ${money(quote.estimatedCosts.localExpenses)} local + ${money(quote.estimatedCosts.safetyBuffer)} buffer.</p><p><strong>Estimated group total:</strong> ${money(quote.estimate.low)}–${money(quote.estimate.high)} · midpoint ${money(quote.estimate.midpoint)}. ${quote.estimate.midpoint > state.search.budget ? `Over budget by ${money(quote.estimate.midpoint - state.search.budget)}.` : quote.estimate.high > state.search.budget ? 'High end crosses your budget.' : 'Range fits the entered cap.'}</p>` : `<p>Full trip price unknown. ${hotel?.totalStay ? `One hotel stay quote: ${money(hotel.totalStay)}; transport and other expenses are not verified.` : 'No complete flight + hotel combination.'} Demo estimate below is separate.</p>`}<small>${esc(quote.message)} One selected itinerary and hotel, not guaranteed bookable prices. ${flight?.note ? esc(flight.note) : ''}</small></div>`;
}

function discussionSection(item) {
  const record = state.discussions[item.id];
  const limitReached = state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit;
  const entries = record?.discussions || [];
  const topics = [...new Set(entries.map((entry) => entry.topic).filter(Boolean))];
  return `<div class="memo-card discussion-note"><h4>Traveler Voices · Relevant Discussions ${evidenceTag('search', 'Search previews')}</h4>${entries.length ? `<p><strong>What travelers like:</strong> Search previews cover ${esc(topics.slice(0, 2).join(' and ') || 'trip advice')}; read the linked posts to verify individual views.</p><p><strong>Things to consider:</strong> Previews cannot establish a destination-wide consensus or confirm full post context.</p>` + entries.map((entry) => `<div class="discussion-item"><a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.title)} ↗</a><p>${esc(entry.preview)}</p><small>Reddit · ${esc(entry.topic || 'trip advice')} · ${entry.date ? esc(entry.date) : 'Date unavailable'} · Google search preview, not a verified Reddit quotation</small></div>`).join('') + `<small>Search checked ${esc(new Date(record.checkedAt).toLocaleString('en-US'))}. Relevance is not an upvote ranking.</small>` : `<p>${record ? 'No verified community posts found.' : 'Search public discussions only when you want them.'}</p>`}${state.discussionErrors[item.id] ? `<p class="request-feedback failed" role="status">${esc(state.discussionErrors[item.id])}</p>` : ''}<button type="button" class="reset-button" data-discussions="${esc(item.id)}" ${state.discussionLoading[item.id] || !state.serpConfigured || limitReached ? 'disabled' : ''}>${state.discussionLoading[item.id] ? 'Searching…' : limitReached ? 'Daily search limit reached' : record ? 'Refresh discussions' : 'Find Reddit discussions'}</button>${!state.serpConfigured ? '<small>Configure SerpApi to enable public discussion search.</small>' : ''}</div>`;
}
function detailSections(item) {
  const season = item.bestMonths.map((month) => new Date(Date.UTC(2026, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })).join(' · ');
  const transit = item.cost.routeKnown
    ? `An operator lists this rail corridor. Service on your date, fare, duration and local connections still need checking.`
    : `This ${item.cost.mode.toLowerCase()} is a distance-based demo candidate. A usable itinerary and duration have not been verified.`;
  const budgetNote = item.cost.total > state.search.budget
    ? `Budget stretch by ${money(item.cost.total - state.search.budget)} at the midpoint. Shortening the trip or raising the group cap may help.`
    : item.cost.high > state.search.budget
      ? `Midpoint fits, but the high end exceeds your cap by ${money(item.cost.high - state.search.budget)}. Keep a price buffer.`
      : `The full modeled range fits the group cap; verify actual prices before booking.`;
  const wiki = `https://en.wikivoyage.org/wiki/Special:Search?search=${encodeURIComponent(`${item.city} ${item.state}`)}`;
  const xhsSearch = `https://www.google.com/search?q=${encodeURIComponent(`site:xiaohongshu.com ${item.city} ${item.state} travel`)}`;
  return `<div class="destination-notes">${livePriceSection(item)}${discussionSection(item)}<div class="memo-card"><h4>Why This Trip Fits You</h4><p>${item.reasons.map(esc).join(' ')}</p><small>${state.search.source.includes('Gemini') ? 'Gemini interpreted your preferences; the local engine calculated these destination reasons.' : 'Reasons calculated from your edited preferences and local destination model.'}</small></div><div class="memo-card"><h4>What to Know Before Going</h4><p>${item.cautions.map(esc).join(' ')}</p><small>Routes, fees and availability can change; source badges identify which facts are checked.</small></div><div class="memo-card"><h4>Planning notes</h4><p>${esc(item.tagline)} Suggested stay: ${item.idealDays[0]}–${item.idealDays[1]} days. Curated season: ${esc(season)}.</p><p><strong>Budget:</strong> ${esc(budgetNote)}</p><p><strong>Getting around:</strong> ${esc(transit)} No-car suitability is a curated score of ${item.carFree}/100, not a transit guarantee.</p></div><div class="memo-card weather-note" data-weather-for="${esc(item.id)}"><h4>Weather lens ${evidenceTag('curated', 'Seasonal expectation')}</h4><p>Curated favorable months: ${esc(season)}. Open this note to check whether an official short-range forecast is available.</p><small>Forecasts are only requested for dates within 7 days; dates farther out show this seasonal note.</small></div><div class="memo-card voices-note" data-voices-for="${esc(item.id)}"><h4>Traveler voices ${evidenceTag('community')}</h4><p>No verified community voices available yet.</p></div><div class="memo-card source-notes"><h4>Sources & confidence</h4><ul>${destinationEvidence(item).map((record) => `<li>${evidenceTag(record.type)} <strong>${esc(record.label)}</strong> — ${esc(record.detail)}${record.url ? ` <a href="${esc(record.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ''}</li>`).join('')}</ul><p>Data confidence: ${esc(item.dataConfidence.level)}. ${esc(item.dataConfidence.reason)}</p></div><div class="planning-links"><strong>Check before you book</strong><a href="${esc(wiki)}" target="_blank" rel="noopener noreferrer">Wikivoyage guide ↗</a>${item.cost.routeSource ? `<a href="${esc(item.cost.routeSource)}" target="_blank" rel="noopener noreferrer">Amtrak corridor ↗</a>` : ''}<a href="https://www.google.com/travel/flights" target="_blank" rel="noopener noreferrer">Search actual flights ↗</a><a href="https://www.google.com/travel/hotels" target="_blank" rel="noopener noreferrer">Search actual stays ↗</a><a href="${esc(xhsSearch)}" target="_blank" rel="noopener noreferrer">Search public Xiaohongshu pages ↗</a></div></div>`;
}

async function loadDetailEvidence(details) {
  const id = details.closest('.result-card')?.dataset.destination;
  if (!id) return;
  const voices = details.querySelector('[data-voices-for]');
  const weather = details.querySelector('[data-weather-for]');
  if (voices) {
    if (!state.communityCache[id]) {
      if (!communityPending.has(id)) communityPending.set(id, (async () => {
        try {
          const response = await fetch(`/api/community?destination=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(6000) });
          if (!response.ok) throw Error('Unavailable');
          state.communityCache[id] = (await response.json()).quotes || [];
        } catch { state.communityCache[id] = []; }
        finally { communityPending.delete(id); }
      })());
      await communityPending.get(id);
    }
    const quotes = state.communityCache[id];
    voices.innerHTML = `<h4>Traveler voices ${evidenceTag('community')}</h4>${quotes.length ? quotes.map((entry) => `<blockquote><p>“${esc(entry.quote)}”</p><cite>${esc(entry.platform)} · ${esc(entry.theme)} · ${esc(entry.date)} · <a href="${esc(entry.sourceLink)}" target="_blank" rel="noopener noreferrer">${esc(entry.noteTitle || 'Original post')} ↗</a></cite></blockquote>`).join('') + '<small>Source-linked manual excerpts; context and current availability must be checked at the original posts.</small>' : '<p>No verified community voices available yet.</p>'}`;
  }
  if (weather) {
    const date = state.search.date.toISOString().slice(0, 10);
    const cacheKey = `${id}:${date}`;
    if (!state.weatherCache[cacheKey]) {
      if (!weatherPending.has(cacheKey)) weatherPending.set(cacheKey, (async () => {
        try {
          const response = await fetch(`/api/weather?destination=${encodeURIComponent(id)}&date=${date}`, { signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw Error('Unavailable');
          state.weatherCache[cacheKey] = await response.json();
        } catch { state.weatherCache[cacheKey] = { available: false, reason: 'Official forecast could not be loaded.' }; }
        finally { weatherPending.delete(cacheKey); }
      })());
      await weatherPending.get(cacheKey);
    }
    const value = state.weatherCache[cacheKey];
    const item = DESTINATIONS.find((destination) => destination.id === id);
    const season = item.bestMonths.map((month) => new Date(Date.UTC(2026, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })).join(' · ');
    weather.innerHTML = `<h4>Weather lens ${value.available ? evidenceTag('official', 'Official forecast') : evidenceTag('curated', 'Seasonal expectation')}</h4>${value.available ? `<p>${esc(value.date)}: ${esc(value.summary)}, ${esc(value.temperature)}${esc(value.temperatureUnit)}. Forecast retrieved ${esc(new Date(value.retrievedAt).toLocaleString('en-US'))}.</p><small>Conditions may change. <a href="${esc(value.sourceUrl)}" target="_blank" rel="noopener noreferrer">US National Weather Service ↗</a></small>` : `<p>Curated favorable months: ${esc(season)}.</p><small>${esc(value.reason)} No date-specific forecast is claimed.</small>`}`;
  }
}

function resultCard(item, index) {
  const { cost, components } = item;
  const selected = state.selectedCompare.includes(item.id);
  const diff = state.search.budget - cost.total;
  const statusLabel = item.status === 'feasible' ? item.live?.estimate ? 'Estimated midpoint within budget · verify final price' : 'Within budget · demo-feasible' : item.status === 'stretch' ? 'Budget Stretch · not feasible' : item.status === 'unverified' ? 'Needs route verification' : 'Excluded by a hard limit or wide budget gap';
  const rankLabel = item.status === 'feasible' ? `#${String(index + 1).padStart(2, '0')} MATCH` : item.status === 'stretch' ? 'BUDGET STRETCH' : item.status === 'unverified' ? 'ROUTE UNVERIFIED' : 'EXPLORE ONLY';
  const matchText = item.preferenceMatch.requested
    ? `${item.preferenceMatch.matched} of ${item.preferenceMatch.requested} curated signals matched${item.preferenceMatch.labels.length ? ` · ${item.preferenceMatch.labels.slice(0, 3).join(', ')}` : ''}`
    : 'No signals selected · neutral baseline';
  const riskText = item.priceRisk === 'upper-range-over' ? `High end is ${money(cost.high - state.search.budget)} above budget` : item.priceRisk === 'over-midpoint' ? `Midpoint is ${money(-diff)} above budget` : 'Full demo range is within budget';
  return `<article class="result-card ${item.status}" data-destination="${esc(item.id)}"><div class="result-photo">${photo(item)}<div class="rank-badge">${rankLabel}</div>${item.photo ? `<div class="photo-source"><a href="${esc(item.photo.source)}" target="_blank" rel="noopener noreferrer" title="View image source and license">Photo: ${esc(item.photo.credit)} · ${esc(item.photo.license)}${item.photo.modified ? ` · ${esc(item.photo.modified)}` : ''} ↗</a></div>` : ''}</div>
    <div class="result-body"><div class="card-top"><div><span class="region-label">${esc(item.region)}</span><h3>${esc(item.city)}<span>, ${esc(item.state)}</span></h3></div><div class="overall-score"><small>OVERALL RECOMMENDATION</small>${scoreRing(item.score)}</div></div><p class="card-tagline">${esc(item.tagline)}</p><div class="tags">${item.highlights.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
    <div class="feasibility-state ${item.status}"><strong>${statusLabel}</strong><span>${esc(item.feasibilityNote)}</span></div><p class="rank-explain">${esc(rankingNote(item))}</p>
    <div class="preference-match"><strong>Preference Match <span>${item.preferenceMatch.score}/100</span></strong><small>${esc(matchText)} · tag overlap, not verified trip quality</small></div><div class="data-confidence"><strong>Data Confidence: ${esc(item.dataConfidence.level)}</strong><small>${esc(item.dataConfidence.reason)}</small></div><div class="card-source-strip">${item.live?.estimate ? evidenceTag(item.live.status === 'cached' ? 'cached' : 'live', item.live.status === 'cached' ? 'Cached flight + hotel' : 'Live flight + hotel') : ''}${evidenceTag('modeled')}${evidenceTag('curated')}${evidenceTag(item.cost.routeKnown ? 'official' : 'provisional', item.cost.routeKnown ? 'Rail corridor sourced' : 'Route unverified')}</div>
    ${item.live?.estimate ? `<div class="live-card-summary"><strong>${item.live.status === 'cached' ? 'Cached Price' : 'Live quote available'} · estimated group total ${money(item.live.estimate.low)}–${money(item.live.estimate.high)}</strong><small>Flight + hotel quoted; local spending modeled · checked ${esc(new Date(item.live.flight.checkedAt).toLocaleString('en-US'))}${item.live.estimate.high > state.search.budget ? ' · high end exceeds budget' : ''}</small></div>` : item.live ? `<div class="live-card-summary muted">Live pricing incomplete. Open details for missing pieces; demo estimate remains separate.</div>` : ''}<div class="metric-row"><div><small>DEMO GROUP TOTAL · MIDPOINT</small><strong>${money(cost.total)}</strong><span>Range ${money(cost.low)}–${money(cost.high)}</span></div><div><small>DEMO BUDGET DIFFERENCE</small><strong class="${diff < 0 ? 'negative' : 'positive'}">${diff < 0 ? '−' : '+'}${money(Math.abs(diff))}</strong><span>${diff < 0 ? 'over midpoint' : 'remaining at midpoint'}</span></div></div>
    <div class="cost-snapshot"><span>Transportation <strong>${money(cost.transport)}</strong></span><span>Accommodation <strong>${money(cost.lodging)}</strong></span><span>Other Expenses <strong>${money(cost.other)}</strong></span></div><div class="buffer-note">Group total also includes a ${money(cost.buffer)} demo buffer.</div>
    <div class="price-risk ${item.priceRisk}">${icon('info', 14)} ${riskText}</div>
    <div class="card-route">${icon(cost.mode === 'Flight estimate' ? 'plane' : 'pin', 17)} <span>${esc(cost.mode)} · travel time unknown</span>${cost.routeSource ? `<a href="${esc(cost.routeSource)}" target="_blank" rel="noopener noreferrer">Corridor source ↗</a>` : '<span>Demo route model</span>'}</div>
    <div class="card-details"><div class="detail-title">Why it fits</div><ul>${item.reasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul><p class="tradeoff"><strong>Keep in mind</strong> ${esc(item.cautions.slice(0, 3).join(' '))}</p></div>
    ${item.stretchAdjustment ? `<p class="stretch-adjustment">${esc(item.stretchAdjustment)}</p>` : ''}<details class="breakdown"><summary>See cost & score breakdown <span>+</span></summary><div class="breakdown-inner"><div class="breakdown-grid"><div><h4>Demo cost estimate</h4><div><span>Transportation · round-trip ${cost.mode.toLowerCase()}</span><strong>${money(cost.transport)}</strong></div><div><span>Accommodation · ${cost.rooms} room${cost.rooms > 1 ? 's' : ''}, ${cost.nights} night${cost.nights > 1 ? 's' : ''}</span><strong>${money(cost.lodging)}</strong></div><div><span>Other expenses · food, local travel, activities</span><strong>${money(cost.other)}</strong></div><div><span>10% buffer</span><strong>${money(cost.buffer)}</strong></div><div><span>Group total · midpoint</span><strong>${money(cost.total)}</strong></div><div><span>Budget difference</span><strong>${diff < 0 ? '−' : '+'}${money(Math.abs(diff))}</strong></div></div><div><h4>Overall Recommendation · ${item.score}/100</h4>${Object.entries(components).map(([key, value]) => `<div><span>${key === 'preference' ? 'Preference Fit' : key === 'budget' ? 'Budget Fit' : key === 'travel' ? 'Travel Ease' : 'Trip Experience'} · ${weightPercentages(state.results.effectiveWeights)[key]}%</span><strong>${value} → ${Math.round(value * state.results.effectiveWeights[key])} pts</strong></div>`).join('')}<p class="score-explain">Preference Match is ${item.preferenceMatch.matched}/${item.preferenceMatch.requested} selected interests. ${item.live?.estimate ? 'Travel Ease also uses the selected flight itinerary duration; ground transfers are not verified.' : 'Travel Ease uses a distance-per-day proxy; actual travel time is unknown.'}</p></div></div>${detailSections(item)}<p class="breakdown-note">The demo breakdown above uses modeled assumptions. Any API-returned quote is shown in its own note. Source badges describe each fact; always confirm current booking terms.</p></div></details>
    ${state.serpConfigured && item.status !== 'excluded' ? `<button type="button" class="card-live-action" data-check-trip="${esc(item.id)}" ${state.liveLoading || state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit ? 'disabled' : ''}>${state.liveLoading && state.liveCardStates[item.id]?.phase === 'loading' ? 'Checking this trip…' : state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit ? 'Daily search limit reached' : item.live?.estimate ? 'Refresh this trip’s live prices' : 'Check this trip’s live prices'}</button>${state.liveCardStates[item.id] ? `<p class="card-request-state ${esc(state.liveCardStates[item.id].phase)}" role="status">${esc(state.liveCardStates[item.id].message)}</p>` : ''}` : ''}<button type="button" class="compare-button ${selected ? 'selected' : ''}" data-compare="${item.id}" aria-pressed="${selected}">${selected ? icon('check', 16) + ' Added to comparison' : icon('compare', 16) + ' Compare this place'}</button></div></article>`;
}

function comparePanel() {
  if (!state.selectedCompare.length) return '';
  const visible = [...state.results.results, ...state.results.stretches, ...state.results.needsVerification, ...state.results.explore];
  const items = state.selectedCompare.map((id) => visible.find((item) => item.id === id)).filter(Boolean);
  const row = (label, fn) => `<tr><th scope="row">${label}</th>${items.map((item) => `<td>${fn(item)}</td>`).join('')}</tr>`;
  return `<section class="compare-section" aria-label="Destination comparison"><div class="compare-header"><div><span class="section-kicker">SIDE BY SIDE</span><h3>Compare your picks <span>${items.length}/3</span></h3></div><button type="button" class="clear-button" id="clear-compare">Clear selection ${icon('close', 15)}</button></div><div class="table-scroll"><table><thead><tr><th scope="col">What matters</th>${items.map((item) => `<th scope="col">${esc(item.city)}, ${esc(item.state)}<button type="button" data-remove="${item.id}" aria-label="Remove ${esc(item.city)} from comparison">${icon('close', 13)}</button></th>`).join('')}</tr></thead><tbody>
  ${row('Feasibility', (item) => `<span class="table-status ${item.status}">${item.status === 'feasible' ? item.live?.estimate ? 'Within budget · quote-supported estimate' : 'Within budget · demo-feasible' : item.status === 'stretch' ? 'Budget Stretch · over limit' : item.status === 'unverified' ? 'Route unverified' : 'Excluded by a limit'}</span>`)}
  ${row('Overall Recommendation', (item) => `<strong>${item.score}/100</strong>`)}
  ${row('Preference Match', (item) => `${item.preferenceMatch.score}/100 · ${item.preferenceMatch.matched}/${item.preferenceMatch.requested} interests`)}
  ${row('Data Confidence', (item) => `${esc(item.dataConfidence.level)} · ${esc(item.dataConfidence.reason)}`)}
  ${row('Quote-supported midpoint', (item) => item.live?.estimate ? `${money(item.live.estimate.midpoint)} · local expenses estimated` : 'Unavailable')}
  ${row('Demo group midpoint', (item) => `<strong>${money(item.cost.total)}</strong><small>Range ${money(item.cost.low)}–${money(item.cost.high)}</small>`)}
  ${row('Budget difference', (item) => { const total = item.live?.estimate?.midpoint ?? item.cost.total; return `${total > state.search.budget ? '−' : '+'}${money(Math.abs(state.search.budget - total))} · ${item.live?.estimate ? 'quote-supported estimate' : 'demo midpoint'}`; })}
  ${row('Demo transportation', (item) => money(item.cost.transport))}
  ${row('Demo accommodation', (item) => money(item.cost.lodging))}
  ${row('Demo other expenses', (item) => money(item.cost.other))}
  ${row('Travel', (item) => item.live?.estimate ? `${item.live.flight.outbound.durationMinutes + item.live.flight.returning.durationMinutes} min selected round-trip itinerary · ground transfers unknown` : `${item.cost.mode} · time unknown · distance burden ${Math.round(item.travelBurden * 100)}/100`)}
  ${row('Without a car', (item) => item.carFree >= 65 ? 'Demo suitability only' : 'May be difficult')}
  ${row('Top trade-off', (item) => esc(item.drawback))}
  ${row('Why it fits', (item) => esc(item.reasons.join(' ')))}
  ${row('Sources', (item) => destinationEvidence(item).map((record) => `${SOURCE_TYPES[record.type].label}: ${esc(record.label)}`).join('<br>'))}
  ${row('Traveler voices', (item) => `${state.communityCache[item.id]?.length || 0} manual excerpts · ${state.discussions[item.id]?.discussions?.length || 0} source-linked search previews · open details`)}
  </tbody></table></div><p class="compare-note">Base card prices and destination traits are demo assumptions. Quote-supported amounts, if present, are shown separately; local transfers remain unknown.</p></section>`;
}

function summaryTicket() {
  const plan = state.search;
  const limits = [plan.constraints.noFlights ? 'No flights' : null, plan.constraints.noCar ? 'No rental car' : null, plan.constraints.directOnly ? 'No layovers' : null].filter(Boolean);
  return `<div class="trip-ticket" aria-label="Current trip search"><div><small>DEPARTING</small><strong>${esc(plan.origin.name)}</strong></div><div><small>DATE</small><strong>${esc(plan.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</strong></div><div><small>GROUP CAP</small><strong>${money(plan.budget)}</strong></div><div><small>TRIP</small><strong>${plan.days} days · ${plan.travelers} traveler${plan.travelers === 1 ? '' : 's'}</strong></div><div><small>LIMITS</small><strong>${esc(limits.length ? limits.join(' · ') : 'No transport exclusions')}</strong></div><span class="ticket-mode">${plan.budgetMode === 'flexible' ? 'FLEXIBLE' : 'STRICT'} BUDGET</span></div>`;
}

async function checkLivePrices(refresh = false, destinationId = null) {
  if (state.liveLoading) return;
  if (state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit) { state.livePhase = 'quota'; state.liveError = 'Local daily search limit reached. No new request was sent; modeled estimates remain available.'; renderResults(true); return; }
  const choices = [...state.results.results, ...state.results.needsVerification, ...state.results.stretches, ...state.results.explore];
  const picks = destinationId ? choices.filter((item) => item.id === destinationId && item.status !== 'excluded').slice(0, 1) : refresh ? Object.keys(state.liveQuotes).map((id) => choices.find((item) => item.id === id && item.status !== 'excluded')).filter(Boolean).slice(0, 2) : choices.filter((item) => item.status !== 'excluded').slice(0, 2);
  if (!picks.length) { state.liveError = 'No eligible or near-budget candidate is available for a live check.'; renderResults(true); return; }
  const before = state.results.results;
  const revision = state.searchRevision;
  state.liveLoading = true; state.livePhase = 'loading'; state.liveError = `Checking ${picks.length} trip${picks.length === 1 ? '' : 's'}…`;
  for (const pick of picks) state.liveCardStates[pick.id] = { phase: 'loading', message: 'Loading live quotes…' };
  renderResults(true);
  try {
    const response = await fetch('/api/live/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originId: state.search.origin.id, destinationIds: picks.map((item) => item.id), date: state.search.date.toISOString().slice(0, 10), days: state.search.days, travelers: state.search.travelers, constraints: state.search.constraints, refresh }), signal: AbortSignal.timeout(60000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message || 'Live pricing unavailable.');
    if (revision !== state.searchRevision) return;
    for (const quote of value.results || []) {
      state.liveQuotes[quote.destinationId] = quote;
      const phase = ['live','cached'].includes(quote.status) ? 'success' : ['live','cached'].includes(quote.flight?.status) || ['live','cached'].includes(quote.hotel?.status) ? 'partial' : 'failed';
      state.liveCardStates[quote.destinationId] = { phase, message: phase === 'success' ? 'Success · flight + hotel quote received; trip total remains estimated.' : phase === 'partial' ? 'Partial · a trip cost is still unknown. Open details.' : 'Failed · no usable live quote. Open details for the reason.' };
    }
    for (const pick of picks) if (state.liveCardStates[pick.id]?.phase === 'loading') state.liveCardStates[pick.id] = { phase: 'failed', message: 'Failed · search stopped before this trip was checked.' };
    if (value.results?.some((quote) => ['live','cached'].includes(quote.flight?.status) || ['live','cached'].includes(quote.hotel?.status))) state.serpVerified = true;
    state.liveUsage = value;
    state.results = mergeLiveQuotes(recommend(state.search), state.liveQuotes, state.search);
    state.lastWeightChanged = 'live quote evidence';
    state.rankChanges = Object.fromEntries(state.results.results.map((item, index) => {
      const previous = before.findIndex((old) => old.id === item.id);
      return [item.id, { priorRank: previous + 1, rank: index + 1, scoreDelta: previous < 0 ? 0 : item.score - before[previous].score }];
    }));
    const complete = (value.results || []).filter((quote) => ['live','cached'].includes(quote.status)).length;
    const partial = (value.results || []).filter((quote) => quote.status === 'unverified' && (['live','cached'].includes(quote.hotel?.status) || ['live','cached'].includes(quote.flight?.status))).length;
    state.livePhase = value.limitReached ? 'quota' : complete === picks.length ? 'success' : complete || partial ? 'partial' : 'failed';
    state.liveError = value.limitReached ? value.limitReason === 'provider_limit' ? 'SerpApi reported a provider quota or rate limit. No more destinations were searched.' : `Local search limit reached (${value.localQueriesToday}/${value.localDailyLimit}). No more destinations were searched.` : state.livePhase === 'success' ? `Success: ${complete} complete flight + hotel quote${complete === 1 ? '' : 's'}. Group totals still include estimated expenses.` : state.livePhase === 'partial' ? `Partial: ${complete} complete, ${partial} partial. Missing transport or hotel prices remain unknown; demo estimates are separate.` : `Failed: no complete live quote. ${value.results?.map((quote) => [quote.flight?.reason, quote.hotel?.reason].filter(Boolean).join(' ')).filter(Boolean).slice(0, 1).join(' ') || 'Check the trip details for missing data.'}`;
  } catch (error) { if (revision === state.searchRevision) { state.livePhase = 'failed'; state.liveError = `Failed: ${error?.message || 'Live pricing unavailable.'} View modeled estimates instead.`; for (const pick of picks) state.liveCardStates[pick.id] = { phase: 'failed', message: state.liveError }; } }
  finally { state.liveLoading = false; if (revision === state.searchRevision) renderResults(true); }
}

async function fetchDiscussions(id, refresh = false) {
  if (state.discussionLoading[id]) return;
  delete state.discussionErrors[id];
  state.discussionLoading[id] = true; renderResults(true);
  try {
    const response = await fetch('/api/live/discussions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId: id, refresh }), signal: AbortSignal.timeout(25000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message || 'Search unavailable.');
    state.discussions[id] = value;
    state.serpVerified = true;
    state.liveError = '';
  } catch (error) { state.discussionErrors[id] = `${error?.message || 'Search unavailable.'} Existing manual voices remain available.`; }
  finally {
    delete state.discussionLoading[id];
    try { const status = await fetch('/api/data/status', { signal: AbortSignal.timeout(4000) }); if (status.ok) state.liveUsage = (await status.json()).serpapi || state.liveUsage; } catch { /* Search result remains usable. */ }
    renderResults(true);
  }
}

function renderResults(preserveControls = false) {
  const root = document.querySelector('#results');
  if (!state.search || !state.results) return;
  const oldPanel = preserveControls ? root.querySelector('.weights-panel') : null;
  const openDetails = preserveControls ? [...root.querySelectorAll('.result-card .breakdown[open]')].map((details) => details.closest('.result-card')?.dataset.destination).filter(Boolean) : [];
  const { results, stretches, needsVerification, explore, totalCandidates, exclusionCounts } = state.results;
  const emptyState = describeResultState(state.results);
  const allVisible = [...results, ...stretches, ...needsVerification, ...explore];
  root.innerHTML = `<div class="results-heading"><div><div class="section-kicker">YOUR SHORTLIST</div><h2>${results.length ? `Places worth a closer look<span class="accent-stop">.</span>` : 'No confirmed model-feasible match.'}</h2><p>${esc(dateLine())}</p></div><div class="results-count">${results.length ? `${results.length} within-budget picks` : 'Adjust your limits'}</div></div>
  ${summaryTicket()}<div class="live-toolbar"><div><strong>Live quote check</strong><small>${state.serpConfigured ? (state.serpVerified ? 'SerpApi connected this session' : 'SerpApi configured · connection unverified') + ' · only when clicked · up to two leading picks · local safety limit ' + (state.liveUsage?.localQueriesToday ?? 0) + '/' + (state.liveUsage?.localDailyLimit ?? 8) + ' today (not official balance)' : 'Add a SerpApi key in the server .env to enable live checks'}</small></div><button type="button" id="check-live" ${!state.serpConfigured || state.liveLoading || state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit ? 'disabled' : ''}>${state.liveLoading ? 'Checking quotes…' : state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit ? 'Daily limit reached' : 'Check Live Prices'}</button>${Object.keys(state.liveQuotes).length ? `<button type="button" id="refresh-live" ${state.liveLoading || state.liveUsage?.localQueriesToday >= state.liveUsage?.localDailyLimit ? 'disabled' : ''}>Refresh live data</button>` : ''}</div>${state.liveError ? `<p class="live-error" role="status">${esc(state.liveError)}</p>` : ''}${state.results.liveUpdated ? '<p class="live-updated">Rank updated using API-returned flight and hotel quotes; local expenses remain estimated.</p>' : ''}<div class="trust-banner"><span>${icon('info', 20)}</span><p><strong>Modeled estimates + ${esc(state.search.source)}.</strong> ${state.search.source.includes('AI Preference') ? 'AI extracted preferences only; the local engine combines available quotes and modeled expenses for scoring.' : 'Local rules extracted preferences; no AI call was made.'} The DEMO cost shown on each card is modeled; any API-returned quote appears separately with a timestamp. Open a card for sources, official short-range weather when available, and planning links.</p></div>
  <div class="results-layout"><aside class="weights-panel"><div class="weights-icon">${icon('sliders', 20)}</div><h3>Make it your trip</h3><p>Drag to rerank instantly. Hard limits always stay in place.</p>${Object.entries(weightLabels).map(([key, label]) => `<label class="weight-control" for="weight-${key}"><span>${label}<strong data-weight-value="${key}">${weightPercentages(state.results.effectiveWeights)[key]}%</strong></span><input id="weight-${key}" type="range" min="0" max="100" step="5" value="${state.weights[key]}" data-weight="${key}" aria-label="${label} relative importance" /></label>`).join('')}<div class="weight-presets"><button type="button" data-preset="budget">Save money</button><button type="button" data-preset="travel">Easy trip</button><button type="button" data-preset="preference">My vibe</button><button type="button" data-preset="experience">Best season</button></div><button id="reset-weights" type="button" class="reset-button">Reset weights</button><div class="weight-footnote">Shown percentages sum to 100%. Budget-interest text adds 15 budget points. Score is model fit, not objective trip utility.</div></aside>
  <div class="result-content"><div class="tier-heading"><div><span class="tier-dot"></span><h3>Best Fits Within Budget <small>under demo assumptions</small></h3></div><span>${totalCandidates} eligible</span></div>${results.length ? `<div class="result-toolbar"><span>Ranked by your current weights</span><span>Midpoint at or below budget</span></div><div class="result-grid">${results.map(resultCard).join('')}</div>${results.length < 3 ? `<p class="few-results">Only ${results.length} ${results.length === 1 ? 'place meets' : 'places meet'} the modeled limits. We won't fill the list with over-budget options.</p>` : ''}` : `<div class="empty-card"><div class="empty-illustration">${icon('compass', 36)}</div><h3>${esc(emptyState.title)}</h3><p>${esc(emptyState.detail)}</p><ul class="empty-suggestions">${emptyState.suggestions.map((suggestion) => `<li>${esc(suggestion)}</li>`).join('')}</ul><a href="#plan" class="button button-primary">Adjust my search ${icon('arrow', 17)}</a></div>`}
  <section class="secondary-tier"><div class="tier-heading stretch"><div><span class="tier-dot"></span><h3>Worth Stretching Your Budget <small>never a feasible pick</small></h3></div><span>${stretches.length} optional</span></div><p>${state.search.budgetMode === 'strict' ? 'Strict limit is still on. These are separate what-if ideas, not eligible recommendations.' : 'Flexible Budget is on. These still exceed your entered budget.'}</p>${stretches.length ? `<div class="result-grid">${stretches.map(resultCard).join('')}</div>` : '<p class="tier-empty">No near-budget option meets the other modeled limits.</p>'}</section>
  <section class="secondary-tier"><div class="tier-heading unverified"><div><span class="tier-dot"></span><h3>Explore More Destinations <small>see why they missed the shortlist</small></h3></div><span>${explore.length + needsVerification.length} more</span></div><p>Lower-ranked, over-budget, blocked or unverified places remain visible for exploration. They are not eligible picks.</p><div class="explore-list">${[...needsVerification, ...explore].slice(0, state.exploreOpen ? undefined : 8).map((item) => `<article class="explore-item"><div><span class="region-label">${esc(item.region)}</span><h4>${esc(item.city)}, ${esc(item.state)}</h4><small>${esc(item.exploreReason || item.feasibilityNote)}</small><span class="explore-meta">${item.score}/100 model score · ${money(item.cost.total)} demo midpoint · ${item.preferenceMatch.matched}/${item.preferenceMatch.requested} interests</span></div><div class="explore-actions"><button type="button" data-detail="${item.id}">${state.expandedExplore.includes(item.id) ? 'Hide details' : 'View details'}</button><button type="button" data-compare="${item.id}" aria-pressed="${state.selectedCompare.includes(item.id)}">${state.selectedCompare.includes(item.id) ? 'Added' : 'Compare'}</button></div></article>${state.expandedExplore.includes(item.id) ? resultCard(item, 0) : ''}`).join('')}</div>${explore.length + needsVerification.length > 8 ? `<button type="button" id="toggle-explore" class="reset-button">${state.exploreOpen ? 'Show fewer destinations' : `Explore all ${explore.length + needsVerification.length} destinations`}</button>` : ''}</section></div></div>
  ${allVisible.length ? comparePanel() : ''}<p class="exclusion-note">Demo screening: ${exclusionCounts.sameCity} same-city, ${exclusionCounts.noFlights} outside modeled ground range, ${exclusionCounts.noCar} below no-car threshold, ${exclusionCounts.overBudget} over the midpoint budget. ${exclusionCounts.unverifiedDirect + exclusionCounts.unverifiedGround} routes could not be verified. Only the first tier is model-feasible.</p>`;
  const toolbar = root.querySelector('.live-toolbar');
  if (toolbar && state.livePhase) { root.querySelector('.live-error')?.remove(); toolbar.insertAdjacentHTML('afterend', `<p class="request-feedback ${esc(state.livePhase)}" role="status">${esc(state.liveError)}</p>`); }
  const resultContent = root.querySelector('.result-content');
  if (resultContent && state.weightFeedback) resultContent.insertAdjacentHTML('afterbegin', `<p class="weight-feedback" role="status">${esc(state.weightFeedback)}</p>`);
  if (oldPanel) root.querySelector('.weights-panel')?.replaceWith(oldPanel);
  for (const id of openDetails) root.querySelector(`.result-card[data-destination="${id}"] .breakdown`)?.setAttribute('open', '');
  root.querySelector('#check-live')?.addEventListener('click', () => checkLivePrices(false));
  root.querySelector('#refresh-live')?.addEventListener('click', () => checkLivePrices(true));
  root.querySelectorAll('[data-check-trip]').forEach((button) => button.addEventListener('click', () => checkLivePrices(Boolean(state.liveQuotes[button.dataset.checkTrip]), button.dataset.checkTrip)));
  root.querySelectorAll('[data-discussions]').forEach((button) => button.addEventListener('click', () => fetchDiscussions(button.dataset.discussions, Boolean(state.discussions[button.dataset.discussions]))));
  const updateWeights = (key, weights) => {
    const prior = state.results.results;
    const previousWeights = state.results.effectiveWeights;
    const nextWeights = Object.values(weights).every((value) => value === 0) ? { ...DEFAULT_WEIGHTS } : weights;
    state.weights = nextWeights; state.search.weights = nextWeights; state.lastWeightChanged = weightLabels[key] || 'weights';
    state.results = mergeLiveQuotes(recommend(state.search), state.liveQuotes, state.search);
    state.rankChanges = Object.fromEntries(state.results.results.map((item, index) => {
      const oldIndex = prior.findIndex((old) => old.id === item.id);
      const driver = Object.entries(item.components).sort((a, b) => b[1] * state.results.effectiveWeights[b[0]] - a[1] * state.results.effectiveWeights[a[0]])[0]?.[0];
      return [item.id, { priorRank: oldIndex + 1, rank: index + 1, scoreDelta: oldIndex < 0 ? 0 : item.score - prior[oldIndex].score, ...(oldIndex < 0 ? {} : { beforeScore: prior[oldIndex].score, beforeContribution: Math.round(prior[oldIndex].components[driver] * previousWeights[driver]) }) }];
    }));
    const oldTop = prior[0], newTop = state.results.results[0];
    state.weightFeedback = !oldTop || !newTop ? 'Weights updated. Hard limits still apply.' : oldTop.id !== newTop.id ? `${weightLabels[key] || 'Weights'} changed: #1 ${oldTop.city} (${oldTop.score}) → ${newTop.city} (${newTop.score}). Hard limits still apply.` : `${weightLabels[key] || 'Weights'} changed: #1 ${newTop.city} ${oldTop.score} → ${newTop.score}; order ${prior.map((item) => item.id).join(',') === state.results.results.map((item) => item.id).join(',') ? 'unchanged' : 'changed'}. Hard limits still apply.`;
    renderResults(true);
    root.querySelectorAll('[data-weight]').forEach((slider) => { slider.value = state.weights[slider.dataset.weight]; });
    for (const [name, value] of Object.entries(weightPercentages(state.results.effectiveWeights))) {
      const label = root.querySelector(`[data-weight-value="${name}"]`);
      if (label) label.textContent = `${value}%`;
    }
  };
  if (!oldPanel) {
    const panel = root.querySelector('.weights-panel');
    panel?.addEventListener('input', (event) => {
      if (!event.target.matches('[data-weight]')) return;
      updateWeights(event.target.dataset.weight, { ...state.weights, [event.target.dataset.weight]: Number(event.target.value) });
    });
    panel?.addEventListener('click', (event) => {
      if (event.target.closest('#reset-weights')) { updateWeights('weights', { ...DEFAULT_WEIGHTS }); panel.querySelectorAll('[data-weight]').forEach((slider) => { slider.value = state.weights[slider.dataset.weight]; }); }
      const preset = event.target.closest('[data-preset]')?.dataset.preset;
      if (preset) {
        const weights = Object.fromEntries(Object.keys(weightLabels).map((key) => [key, key === preset ? 85 : 5]));
        updateWeights(preset, weights);
        panel.querySelectorAll('[data-weight]').forEach((slider) => { slider.value = state.weights[slider.dataset.weight]; });
      }
    });
  }
  root.querySelector('#toggle-explore')?.addEventListener('click', () => { state.exploreOpen = !state.exploreOpen; renderResults(); });
  root.querySelectorAll('[data-detail]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.detail;
    state.expandedExplore = state.expandedExplore.includes(id) ? state.expandedExplore.filter((value) => value !== id) : [...state.expandedExplore, id];
    renderResults(true);
  }));
  root.querySelectorAll('[data-compare]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.compare;
    state.selectedCompare = state.selectedCompare.includes(id) ? state.selectedCompare.filter((x) => x !== id) : state.selectedCompare.length < 3 ? [...state.selectedCompare, id] : state.selectedCompare;
    renderResults();
    if (state.selectedCompare.length === 3) document.querySelector('.compare-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  root.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { state.selectedCompare = state.selectedCompare.filter((id) => id !== button.dataset.remove); renderResults(); }));
  root.querySelector('#clear-compare')?.addEventListener('click', () => { state.selectedCompare = []; renderResults(); });
  root.querySelectorAll('.result-card .breakdown').forEach((details) => {
    details.addEventListener('toggle', () => { if (details.open) loadDetailEvidence(details); });
    if (details.open) loadDetailEvidence(details);
  });
  wireImageFallbacks();
}

renderShell();
fetch('/api/preferences/status').then((response) => response.json()).then((value) => {
  state.aiAvailable = value.available === true;
  state.aiMode = value.mode || 'demo-only';
  const button = document.querySelector('#analyze-ai');
  if (button) button.disabled = !state.aiAvailable;
  const status = document.querySelector('.ai-actions span:last-child');
  if (status) status.textContent = state.aiAvailable ? (state.aiMode === 'local-ollama' ? 'Local Ollama available · runs only when clicked' : state.aiMode === 'gemini-configured' ? state.geminiVerified ? 'Gemini connected this session' : 'Gemini configured · click to verify access' : 'Cloud AI configured · runs only when clicked') : 'Local rules ready · AI optional';
}).catch(() => { state.aiAvailable = false; });
fetch('/api/data/status').then((response) => response.json()).then((value) => {
  state.serpConfigured = value.serpapi?.configured === true;
  state.serpVerified = value.serpapi?.connectionVerified === true;
  state.geminiVerified = value.gemini?.connectionVerified === true;
  state.liveUsage = value.serpapi || null;
  if (state.search) renderResults(true);
}).catch(() => { state.serpConfigured = false; });
