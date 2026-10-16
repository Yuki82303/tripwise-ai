import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DESTINATIONS } from '../src/data.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = resolve(root, 'assets/destinations');
await mkdir(folder, { recursive: true });
let downloaded = 0;
let failed = 0;

for (const { id, photo } of DESTINATIONS.filter((destination) => destination.photo)) {
  const target = resolve(folder, `${id}.jpg`);
  const temp = resolve(folder, `${id}.download`);
  try {
    if ((await stat(target).catch(() => null))?.size > 0) {
      console.log(`Already saved: ${id}`);
      continue;
    }
    const response = await fetch(photo.url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'TripWisePortfolioPhotoDownloader/1.0 (personal local use)' } });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg')) throw new Error(`Unexpected response: HTTP ${response.status}, ${response.headers.get('content-type')}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 8_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Invalid or oversized JPEG');
    await writeFile(temp, bytes);
    try {
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', temp, '--out', target]);
      await rm(temp, { force: true });
    } catch {
      // The Commons 960px JPEG is already web-sized when sips is unavailable.
      await rm(target, { force: true });
      await rename(temp, target);
    }
    console.log(`Saved: ${id} (${Math.round((await stat(target)).size / 1024)} KB) — ${photo.credit}, ${photo.license}`);
    downloaded++;
  } catch (error) {
    await rm(temp, { force: true });
    console.error(`Could not save ${id}: ${error.message}`);
    failed++;
  }
}
console.log(`Downloaded ${downloaded}; unavailable ${failed}. Missing local images use Commons in the browser, then the illustrated fallback.`);
if (failed) process.exitCode = 1;
