import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export class LiveError extends Error { constructor(code, message) { super(message); this.code = code; } }
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonNegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const positive = (n) => nonNegative(n) && n > 0;
const safeUrl = (url, hosts) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)) && !parsed.searchParams.has('api_key') ? parsed.href : null; } catch { return null; } };

// This official SerpApi MCP endpoint accepts Bearer auth. Search params contain no credential.
// The direct REST search endpoint documents api_key in the URL, so it is intentionally not used.
export class SerpClient {
  constructor({ apiKey, fetchImpl = fetch, root = '.', now = Date.now, dailyLimit = 8, endpoint = 'https://mcp.serpapi.com/mcp' }) {
    this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.root = root; this.now = now;
    this.dailyLimit = Math.min(50, Math.max(1, Number(dailyLimit) || 8)); this.endpoint = endpoint;
    this.cache = new Map(); this.pending = new Map(); this.queue = Promise.resolve(); this.session = null;
  }
  async rpc(method, params, notification = false) {
    const body = { jsonrpc: '2.0', method, ...(notification ? {} : { id: String(++this.requestId || (this.requestId = 1)) }), ...(params ? { params } : {}) };
    let response;
    try { response = await this.fetchImpl(this.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(this.session ? { 'Mcp-Session-Id': this.session } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(18000) }); }
    catch (error) { throw new LiveError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'upstream', 'Live search timed out or could not connect.'); }
    if (!response.ok) throw new LiveError(response.status === 429 ? 'provider_limit' : 'upstream', response.status === 429 ? 'SerpApi reported HTTP 429. Check the provider quota or rate limit.' : `Live search returned HTTP ${response.status}.`);
    const session = response.headers?.get?.('mcp-session-id'); if (session) this.session = session;
    if (notification) return null;
    let raw; try { raw = await response.text(); } catch { throw new LiveError('bad_output', 'Live search returned unreadable data.'); }
    if (raw.length > 3_000_000) throw new LiveError('bad_output', 'Live search response was too large.');
    let payload;
    try {
      if (raw.startsWith('data:') || response.headers?.get?.('content-type')?.includes('text/event-stream')) {
        payload = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => { try { return JSON.parse(line.slice(5).trim()); } catch { return null; } }).find((event) => event?.id === body.id);
      } else payload = JSON.parse(raw);
    } catch { throw new LiveError('bad_output', 'Live search returned invalid JSON.'); }
    if (!payload || payload.error) throw new LiveError('upstream', 'Live search could not complete.');
    return payload.result;
  }
  async ensureReady() {
    if (this.ready) return;
    if (!this.starting) this.starting = (async () => {
      await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tripwise-local', version: '0.3.0' } });
      await this.rpc('notifications/initialized', undefined, true);
      this.ready = true;
    })().finally(() => { this.starting = null; });
    await this.starting;
  }
  async usage() {
    const date = new Date(this.now()).toISOString().slice(0, 10);
    let raw;
    try { raw = await readFile(join(this.root, 'data', '.serpapi-usage.json'), 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return { date, count: 0 }; throw new LiveError('ledger', 'Could not read local SerpApi safety counter; live search is paused.'); }
    try {
      const record = JSON.parse(raw);
      if (typeof record.date !== 'string' || !Number.isInteger(record.count) || record.count < 0) throw Error('invalid');
      return record.date === date ? record : { date, count: 0 };
    } catch { throw new LiveError('ledger', 'Local SerpApi safety counter is invalid; live search is paused.'); }
  }
  async reserve() {
    const task = this.queue.then(async () => {
      const record = await this.usage();
      if (record.count >= this.dailyLimit) throw new LiveError('daily_limit', `Local SerpApi safety limit reached (${this.dailyLimit} search requests today). Try tomorrow or use modeled estimates.`);
      record.count++;
      const ledger = join(this.root, 'data', '.serpapi-usage.json');
      const temp = `${ledger}.${process.pid}.tmp`;
      try { await writeFile(temp, JSON.stringify(record)); await rename(temp, ledger); }
      catch { throw new LiveError('ledger', 'Could not save local SerpApi safety counter; live search is paused.'); }
      return record;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async search(params, { ttlMs = 6 * 3600_000, refresh = false } = {}) {
    if (!this.apiKey) throw new LiveError('unavailable', 'SerpApi is not configured. Live data is unavailable.');
    const key = hash(params);
    const cached = this.cache.get(key);
    if (!refresh && cached && cached.until > this.now()) return { data: cached.data, checkedAt: cached.checkedAt, freshness: 'cached' };
    if (!refresh && this.pending.has(key)) return this.pending.get(key);
    const job = (async () => {
      await this.reserve(); // Count attempts too; never undercount uncertain upstream billing.
      await this.ensureReady();
      const result = await this.rpc('tools/call', { name: 'search', arguments: { params: { ...params, ...(refresh ? { no_cache: true } : {}) }, mode: 'complete' } });
      if (result?.isError) throw new LiveError('upstream', 'SerpApi search failed.');
      const serialized = result?.structuredContent?.result || result?.content?.find((part) => part.type === 'text')?.text;
      let data;
      try { data = typeof serialized === 'string' ? JSON.parse(serialized) : serialized; } catch { throw new LiveError('bad_output', 'SerpApi returned malformed search results.'); }
      if (!data || typeof data !== 'object' || data.error || data.search_metadata?.status === 'Error') throw new LiveError(typeof data?.error === 'string' && /quota|credit|rate.?limit/i.test(data.error) ? 'provider_limit' : 'upstream', 'SerpApi returned an error or no usable results.');
      this.connectionVerified = true;
      const checkedAt = new Date(this.now()).toISOString();
      this.cache.set(key, { data, checkedAt, until: this.now() + ttlMs });
      return { data, checkedAt, freshness: 'live' };
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
}

const itinerary = (value, from, to, date, directOnly) => {
  if (!Array.isArray(value?.flights) || !value.flights.length || !positive(value.total_duration) || !positive(value.price)) return null;
  const legs = value.flights;
  if (legs[0]?.departure_airport?.id !== from || legs.at(-1)?.arrival_airport?.id !== to || legs[0]?.departure_airport?.time?.slice(0, 10) !== date) return null;
  const layovers = Array.isArray(value.layovers) ? value.layovers.length : Math.max(0, legs.length - 1);
  if (directOnly && layovers) return null;
  return { airline: [...new Set(legs.map((leg) => leg.airline).filter(Boolean))].join(' + ') || 'Airline unavailable', durationMinutes: value.total_duration, layovers,
    departureAirport: from, arrivalAirport: to, departureAt: legs[0].departure_airport.time, arrivalAt: legs.at(-1).arrival_airport?.time || null, price: value.price, token: value.departure_token || null };
};
const flights = (data) => [...(Array.isArray(data.best_flights) ? data.best_flights : []), ...(Array.isArray(data.other_flights) ? data.other_flights : [])];
export function selectOutboundToken(data, { from, to, depart, directOnly = false }) {
  return flights(data).map((value) => itinerary(value, from, to, depart, directOnly)).find((value) => value?.token && value.token.length < 3000)?.token || null;
}

export function parseFlightPair(outbound, returning, { from, to, depart, returnDate, travelers, directOnly = false, checkedAt, freshness }) {
  if (outbound.search_parameters?.currency !== 'USD' || returning.search_parameters?.currency !== 'USD') return { status: 'unavailable', reason: 'Flight currency was not confirmed as USD.' };
  if (Number(outbound.search_parameters?.adults) !== travelers || Number(returning.search_parameters?.adults) !== travelers) return { status: 'unavailable', reason: 'Flight passenger count did not match the search.' };
  if ([outbound, returning].some((data) => data.search_parameters?.outbound_date !== depart || data.search_parameters?.return_date !== returnDate || data.search_parameters?.departure_id !== from || data.search_parameters?.arrival_id !== to || String(data.search_parameters?.type) !== '1')) return { status: 'unavailable', reason: 'Round-trip route or dates did not match the search.' };
  const first = flights(outbound).map((value) => itinerary(value, from, to, depart, directOnly)).find((value) => value?.token);
  if (!first) return { status: 'unavailable', reason: 'Round-trip fare not fully verified: no matching outbound flight token.' };
  if (returning.search_parameters?.departure_token !== first.token) return { status: 'unavailable', reason: 'Round-trip fare not fully verified: return selection did not match the outbound flight.' };
  const second = flights(returning).filter((value) => value.type === 'Round trip').map((value) => itinerary(value, to, from, returnDate, directOnly)).find(Boolean);
  if (!second) return { status: 'unavailable', reason: 'Round-trip fare not fully verified: no matching return flight.' };
  // SerpApi's flight result price is a ticket price; after selecting a return, it is a round-trip ticket price.
  // The group amount is derived explicitly. Never sum outbound and return result prices.
  return { status: freshness === 'cached' ? 'cached' : 'live', farePerTraveler: second.price, groupFare: travelers === 1 ? second.price : null, groupFareEstimate: Math.round(second.price * travelers), fareBasis: travelers === 1 ? 'one ticket for one traveler' : 'unverified ticket price × requested adults', travelers, currency: 'USD', taxesIncluded: null, bookingVerified: false, outbound: first, returning: second,
    checkedAt, source: 'Google Flights via SerpApi', sourceUrl: safeUrl(returning.search_metadata?.google_flights_url || outbound.search_metadata?.google_flights_url, ['google.com']),
    note: travelers === 1 ? 'Selected round-trip ticket price for one traveler; baggage and booking fees may differ.' : 'SerpApi does not explicitly confirm whether the ticket price represents each traveler or the entire group. The multiplied group amount is provisional and excluded from budget reranking until confirmed at checkout.' };
}

export function parseHotels(data, { checkIn, checkOut, travelers, rooms, nights, checkedAt, freshness }) {
  const p = data.search_parameters || {};
  if (p.currency !== 'USD' || p.check_in_date !== checkIn || p.check_out_date !== checkOut || Number(p.adults) !== travelers) return { status: 'unavailable', reason: 'Hotel dates, currency or guest count did not match the search.' };
  if (rooms > 1 && Number(p.rooms) !== rooms) return { status: 'unavailable', reason: 'Room count was not confirmed for this group.' };
  const properties = (Array.isArray(data.properties) ? data.properties : []).filter((hotel) => hotel.type === 'hotel' && typeof hotel.name === 'string' && hotel.name && positive(hotel.total_rate?.extracted_lowest));
  const selected = properties.sort((a, b) => a.total_rate.extracted_lowest - b.total_rate.extracted_lowest)[0];
  if (!selected) return { status: 'unavailable', reason: 'No hotel offered a verified total-stay quote for these dates.' };
  const matchingOffer = selected.prices?.find((price) => positive(price.total_rate?.extracted_lowest) && Math.abs(price.total_rate.extracted_lowest - selected.total_rate.extracted_lowest) < 1);
  const provider = matchingOffer?.source || null;
  return { status: freshness === 'cached' ? 'cached' : 'live', hotel: selected.name, totalStay: selected.total_rate.extracted_lowest, perNight: nonNegative(selected.rate_per_night?.extracted_lowest) ? selected.rate_per_night.extracted_lowest : null,
    checkIn, checkOut, nights, rooms, travelers, currency: 'USD', taxesIncluded: nonNegative(selected.total_rate?.extracted_before_taxes_fees) ? selected.total_rate.extracted_before_taxes_fees < selected.total_rate.extracted_lowest : null,
    rating: nonNegative(selected.overall_rating) ? selected.overall_rating : null, reviewCount: Number.isInteger(selected.reviews) ? selected.reviews : null,
    provider, checkedAt, source: 'Google Hotels via SerpApi', sourceUrl: safeUrl(matchingOffer?.link || selected.link, ['google.com', 'booking.com', 'expedia.com', 'hotels.com']),
    note: 'One hotel stay result, not a citywide price. The linked property page may not preserve this quote; confirm room capacity, final taxes, fees and availability before booking.' };
}

export function parseDiscussions(data, checkedAt, freshness, destination = null) {
  const city = destination?.city?.toLowerCase() || null;
  const useful = /travel|visit|trip|weekend|food|restaurant|walk|transit|train|safety|cost|expensive|crowd|worth|stay|things to do/i;
  const topic = (text) => /walk|transit|train|without a car|parking/i.test(text) ? 'getting around'
    : /food|restaurant|dining/i.test(text) ? 'food' : /crowd|tourist trap/i.test(text) ? 'crowds'
      : /cost|budget|expensive|price/i.test(text) ? 'budget' : /weather|season/i.test(text) ? 'season' : 'trip advice';
  return { status: freshness === 'cached' ? 'cached' : 'live', checkedAt, source: 'Google Search via SerpApi', engagementVerified: false,
    discussions: (Array.isArray(data.organic_results) ? data.organic_results : []).map((result) => ({ title: String(result.title || '').slice(0, 160), url: safeUrl(result.link, ['reddit.com']), preview: String(result.snippet || '').slice(0, 220), date: typeof result.date === 'string' ? result.date.slice(0, 40) : null, topic: topic(`${result.title || ''} ${result.snippet || ''}`) }))
      .filter((result) => result.title && result.url && (!city || `${result.title} ${result.preview}`.toLowerCase().includes(city)) && useful.test(`${result.title} ${result.preview}`)).slice(0, 4) };
}
