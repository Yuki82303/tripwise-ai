import { DESTINATIONS } from './src/data.js';

export async function getNwsForecast({ destinationId, date, fetchImpl = fetch, now = new Date() }) {
  const destination = DESTINATIONS.find((item) => item.id === destinationId);
  if (!destination || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { available: false, reason: 'Invalid destination or date.' };
  const offset = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
  if (offset < 0 || offset > 6) return { available: false, reason: 'Date is outside the reliable short-range forecast window.' };
  const headers = { 'User-Agent': 'TripWiseAI-portfolio/1.0 (local travel planning demo)', Accept: 'application/geo+json' };
  try {
    const points = await fetchImpl(`https://api.weather.gov/points/${destination.lat},${destination.lon}`, { headers, signal: AbortSignal.timeout(5000) });
    if (!points.ok) throw Error('NWS point lookup failed');
    const pointData = await points.json();
    const forecastUrl = pointData?.properties?.forecast;
    const parsedForecastUrl = typeof forecastUrl === 'string' ? new URL(forecastUrl) : null;
    if (!parsedForecastUrl || parsedForecastUrl.protocol !== 'https:' || parsedForecastUrl.hostname !== 'api.weather.gov' || !parsedForecastUrl.pathname.startsWith('/gridpoints/')) throw Error('Invalid NWS forecast URL');
    const forecast = await fetchImpl(forecastUrl, { headers, signal: AbortSignal.timeout(5000) });
    if (!forecast.ok) throw Error('NWS forecast failed');
    const payload = await forecast.json();
    const period = payload?.properties?.periods?.find((entry) => entry.isDaytime && typeof entry.startTime === 'string' && entry.startTime.slice(0, 10) === date);
    if (!period || typeof period.shortForecast !== 'string' || !Number.isFinite(period.temperature) || !['F','C'].includes(period.temperatureUnit)) return { available: false, reason: 'NWS has no usable daytime period for this date.' };
    return { available: true, sourceType: 'official-forecast', source: 'US National Weather Service', sourceUrl: 'https://www.weather.gov/documentation/services-web-api', retrievedAt: now.toISOString(), date, summary: period.shortForecast.slice(0, 120), temperature: period.temperature, temperatureUnit: period.temperatureUnit === 'C' ? '°C' : '°F', confidence: 'Short-range forecast; conditions may change' };
  } catch {
    return { available: false, reason: 'Official forecast could not be loaded. Use the curated season note instead.' };
  }
}
