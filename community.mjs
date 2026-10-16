import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DESTINATIONS } from './src/data.js';

const ids = new Set(DESTINATIONS.map((item) => item.id));
const themes = new Set(['food','transit','crowds','safety','walkability','hidden gem','nightlife','cost','vibe','culture','nature']);
const files = [
  { path: 'data/xiaohongshu_manual_quotes.json', platform: 'Xiaohongshu', hosts: ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com'] },
  { path: 'data/reddit_manual_quotes.json', platform: 'Reddit', hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com'] }
];

export function normalizeQuote(value, config) {
  if (!value || typeof value !== 'object' || !ids.has(value.destination) || typeof value.quote !== 'string' || value.quote.trim().length < 12 || value.quote.length > 220 || !themes.has(value.theme) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date)) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date || typeof value.noteTitle !== 'string' || value.noteTitle.length > 100) return null;
  let url;
  try { url = new URL(value.sourceLink); } catch { return null; }
  if (url.protocol !== 'https:' || !config.hosts.includes(url.hostname) || url.pathname === '/') return null;
  return { destination: value.destination, quote: value.quote.trim(), theme: value.theme, date: value.date, noteTitle: value.noteTitle.trim(), sourceLink: url.href, platform: config.platform, sourceType: 'curated-community', confidence: 'Source-linked; manually entered, not independently verified' };
}

export async function readCommunityQuotes(root, destination) {
  if (!ids.has(destination)) return [];
  const batches = await Promise.all(files.map(async (config) => {
    try {
      const values = JSON.parse(await readFile(resolve(root, config.path), 'utf8'));
      return Array.isArray(values) ? values.map((value) => normalizeQuote(value, config)).filter(Boolean) : [];
    } catch { return []; }
  }));
  return batches.flat().filter((item) => item.destination === destination).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
}
