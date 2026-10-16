import { DESTINATIONS, ORIGINS } from './src/data.js';
import { estimateCost } from './src/engine.js';
import { parseFlightPair, parseHotels, parseDiscussions, selectOutboundToken, LiveError } from './serpapi.mjs';

// Exact city airports only. Regional destinations without a representative city airport stay unmapped.
// Airport mapping alone never asserts that a service exists on the chosen date.
export const AIRPORTS = Object.freeze({
  'new-york': 'JFK', boston: 'BOS', chicago: 'ORD', 'los-angeles': 'LAX', 'san-francisco': 'SFO', seattle: 'SEA',
  miami: 'MIA', 'san-diego': 'SAN', 'new-orleans': 'MSY', denver: 'DEN', 'las-vegas': 'LAS', 'new-york-city': 'JFK',
  'portland-maine': 'PWM', savannah: 'SAV', asheville: 'AVL', philadelphia: 'PHL', 'washington-dc': 'DCA',
  providence: 'PVD', baltimore: 'BWI', 'new-haven': 'HVN', pittsburgh: 'PIT', richmond: 'RIC', charleston: 'CHS',
  nashville: 'BNA', minneapolis: 'MSP', milwaukee: 'MKE', madison: 'MSN', detroit: 'DTW', cleveland: 'CLE',
  columbus: 'CMH', 'portland-oregon': 'PDX', sacramento: 'SMF', 'santa-barbara': 'SBA', 'long-beach': 'LGB',
  'palm-springs': 'PSP', 'salt-lake-city': 'SLC'
});

export function tripDates(date, days) {
  const start = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date || !Number.isInteger(days) || days < 2 || days > 7) throw new LiveError('bad_input', 'Invalid travel dates.');
  const end = new Date(start.getTime() + (days - 1) * 86400000).toISOString().slice(0, 10);
  return { depart: date, returnDate: end, checkIn: date, checkOut: end, nights: days - 1 };
}

const unavailable = (reason) => ({ status: 'unavailable', reason });
export async function checkDestination(client, { originId, destinationId, date, days, travelers, noFlights = false, directOnly = false, modeledOther = 0, refresh = false }) {
  const origin = ORIGINS.find((item) => item.id === originId);
  const destination = DESTINATIONS.find((item) => item.id === destinationId);
  if (!origin || !destination || !Number.isInteger(travelers) || travelers < 1 || travelers > 4) throw new LiveError('bad_input', 'Unsupported origin, destination, or traveler count.');
  const dates = tripDates(date, days);
  const modeledRoute = estimateCost(destination, origin, new Date(`${date}T12:00:00Z`), days, travelers, noFlights);
  const railOnly = modeledRoute.mode === 'Rail candidate';
  const from = AIRPORTS[originId], to = AIRPORTS[destinationId];
  let flight = unavailable(noFlights ? 'No Flights is a hard limit; no flight search was made.' : railOnly ? 'Rail candidate: train fare and schedule are not live-verified; no flight search was made.' : !to ? 'No exact city airport mapping; flight search skipped.' : from === to ? 'Origin and destination use the same mapped airport; flight search skipped.' : 'Flight quote unavailable.');
  let hotel = unavailable('Hotel quote unavailable.');
  const errors = [];
  if (!noFlights && !railOnly && from && to && from !== to) {
    const base = { engine: 'google_flights', departure_id: from, arrival_id: to, outbound_date: dates.depart, return_date: dates.returnDate, type: '1', adults: travelers, currency: 'USD', travel_class: '1', stops: directOnly ? '1' : '0', hl: 'en', gl: 'us' };
    try {
      const outbound = await client.search(base, { refresh });
      const token = selectOutboundToken(outbound.data, { from, to, depart: dates.depart, directOnly });
      if (token) {
        const returning = await client.search({ ...base, departure_token: token }, { refresh });
        flight = parseFlightPair(outbound.data, returning.data, { from, to, depart: dates.depart, returnDate: dates.returnDate, travelers, directOnly, checkedAt: new Date(Math.min(Date.parse(outbound.checkedAt), Date.parse(returning.checkedAt))).toISOString(), freshness: returning.freshness === 'cached' || outbound.freshness === 'cached' ? 'cached' : 'live' });
      } else flight = unavailable('Round-trip fare not fully verified: outbound result had no return-selection token.');
    } catch (error) { flight = unavailable(error.message); errors.push(error.code || 'upstream'); }
  }
  if (travelers > 2) hotel = unavailable('Multi-room occupancy cannot be confirmed by this hotel search. No hotel request was made.');
  else try {
    const quote = await client.search({ engine: 'google_hotels', q: `${destination.city}, ${destination.state} hotels`, check_in_date: dates.checkIn, check_out_date: dates.checkOut, adults: travelers, currency: 'USD', hl: 'en', gl: 'us' }, { refresh });
    hotel = parseHotels(quote.data, { checkIn: dates.checkIn, checkOut: dates.checkOut, travelers, rooms: 1, nights: dates.nights, checkedAt: quote.checkedAt, freshness: quote.freshness });
  } catch (error) { hotel = unavailable(error.message); errors.push(error.code || 'upstream'); }
  const verifiedCosts = (flight.groupFare || 0) + (hotel.totalStay || 0);
  const completeQuote = Boolean(flight.groupFare && hotel.totalStay);
  // Local expenses remain modeled, so even a complete flight+hotel quote cannot verify the whole trip total.
  const other = Number.isFinite(modeledOther) && modeledOther >= 0 ? Math.round(modeledOther) : 0;
  const buffer = completeQuote ? Math.round((verifiedCosts + other) * 0.1) : null;
  const estimate = completeQuote ? { low: verifiedCosts + Math.round(other * 0.8) + buffer, high: verifiedCosts + Math.round(other * 1.25) + buffer, midpoint: verifiedCosts + other + buffer } : null;
  return { destinationId, dates, transportMode: railOnly ? 'rail' : noFlights ? 'ground-unknown' : 'flight', railOperatorUrl: railOnly ? modeledRoute.routeSource : null, flight, hotel, verifiedCosts, estimatedCosts: { localExpenses: other, safetyBuffer: buffer }, estimate,
    status: completeQuote ? (flight.status === 'cached' || hotel.status === 'cached' ? 'cached' : 'live') : 'unverified',
    message: completeQuote ? 'Flight and one hotel quote available; local expenses and safety buffer remain estimated.' : railOnly ? 'Hotel quote may be available. Rail fare and full trip price are unverified; see the operator link.' : 'Live pricing unavailable or incomplete. View modeled estimate separately.', errors };
}

export async function searchDiscussions(client, destinationId, refresh = false) {
  const destination = DESTINATIONS.find((item) => item.id === destinationId);
  if (!destination) throw new LiveError('bad_input', 'Unknown destination.');
  const query = `site:reddit.com ${destination.city} ${destination.state} weekend travel food transit worth visiting`;
  const result = await client.search({ engine: 'google', q: query, num: 5, hl: 'en', gl: 'us' }, { ttlMs: 24 * 3600_000, refresh });
  return { destinationId, query, ...parseDiscussions(result.data, result.checkedAt, result.freshness, destination) };
}
