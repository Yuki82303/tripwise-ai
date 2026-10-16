# TripWise AI — travel decisions with visible evidence

TripWise AI is a local, interactive US getaway recommender and portfolio app. Forty curated destinations are scored against a group's budget, dates, interests and travel limits. Its 0–100 index measures **model fit**, not an objective city rating or a promise that a trip can be booked. The original scrapbook and postcard interface, comparison and adjustable scoring remain.

## Run on a Mac

Requires Node.js 18–22 (Render selects Node 22 from the declared range). No `npm install` is required; there are no third-party runtime dependencies.

```bash
cd "/Users/keyuzhou/Desktop/周科妤-投放专员-10.17/01-交付作品"
npm start
```

Open <http://localhost:4173>. Stop with `Control+C`. Check whether port 4173 is already serving before starting another copy. If another app owns it, use `PORT=4174 npm start` and open <http://localhost:4174>.

```bash
npm test
npm run build
npm run preview
```

`preview` serves the built browser files from `dist/`; the Node API stays in `server.mjs`. Editing `.env` requires restarting the server. The app works without either external API key.

## Deploy on Render

Create a **Node Web Service** from a Git repository containing this project. If the repository root is the parent folder, set **Root Directory** to `01-交付作品`; if the repository root is this project folder, leave Root Directory blank. Use **Build Command** `npm run build` and **Start Command** `npm run preview`. The start command serves `dist/` through the same Node process as `/api/*`; a Render Static Site would not run the API. `package.json` pins Node 22, and the server listens on `0.0.0.0` using Render's `PORT` environment variable. [Render web service setup](https://render.com/docs/web-services).

Add optional `GEMINI_API_KEY` and `SERPAPI_API_KEY` in Render's **Environment** settings, never in the repository. Without them, the rule-based and modeled-data app still runs. `.gitignore` excludes `.env`, `.env.*` except `.env.example`, `dist/`, and the local SerpApi usage file; the HTTP server only serves approved browser assets. After deployment, open the service URL and check `/api/data/status`. Render's filesystem is ephemeral, so the local daily SerpApi counter and in-memory caches reset on restart or redeploy; it is **not** an account-wide quota guard. Keep the provider's own usage limit in mind before enabling live search on a public service.

## Optional Gemini and SerpApi setup

`server.mjs` reads a local `.env` at startup. The file is ignored by `.gitignore`, not served by the static allowlist, and never copied to `dist/`. Keep credentials only in `.env` or server environment variables. Do not paste them into browser code, URLs, screenshots, issues or commits.

```bash
cp .env.example .env
open -e .env
```

Set `GEMINI_API_KEY=...` and/or `SERPAPI_API_KEY=...` locally. If `.env` already exists, **edit it; do not overwrite it with the example**. When `GEMINI_MODEL` is blank, Analyze calls `gemini-3.5-flash-lite` directly in one structured request; this model was previously confirmed reachable by a simple request with the configured key. A model explicitly set in `.env` overrides the default. A successful simple request does not prove structured extraction succeeds. Use a Free Tier project with no paid billing enabled and verify its plan in Google AI Studio. [Official key guide](https://ai.google.dev/gemini-api/docs/api-key), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

The status endpoint `GET /api/data/status` returns only configured/connection-verified flags and the **local** SerpApi request count; it never returns keys or an official account balance. `connectionVerified` becomes true only after a successful API response in the current server session. Simply having a key in `.env` is not proof that it works.

The status response includes `release: portfolio-final-2026-10-16` and `startedAt`. If an older server is already listening on 4173, stop that Terminal process with `Control+C` and run `npm start` again; source edits cannot replace already imported server modules. A Gemini failure shows a short user message and places API version, model, request stage, HTTP status and Google's redacted error detail under **Technical details**. HTTP 400 means the request format was rejected; 401 suggests an invalid key; 403 suggests key restrictions or API access; 429 suggests quota/rate limit. The app falls back to visibly labeled local rules.

For a controlled connection check on your own Mac, run **once**:

```bash
TRIPWISE_LIVE_DIAG=YES npm run diagnose:live
```

The optional command uses a short Gemini note with the officially documented `gemini-3.5-flash-lite` model (or your `GEMINI_MODEL`) and at most one SerpApi `google_flights` search plus one `google_hotels` search. It prints request status, HTTP code, JSON/data validation, elapsed time, safe failure codes and any sanitized Gemini error detail. It never prints keys, headers, raw responses or prices. It uses the existing local SerpApi daily counter. The single Flights query checks only the outbound selection; a confirmed round-trip fare needs another search, so this diagnostic cannot verify a full trip total. Running the command again may use more free searches. Without `TRIPWISE_LIVE_DIAG=YES`, it makes zero external calls.

To diagnose **Gemini only** without spending a SerpApi search, run `TRIPWISE_LIVE_DIAG=YES TRIPWISE_DIAG_GEMINI_ONLY=YES npm run diagnose:live`. The output includes Google's sanitized `error.message` and reason when an HTTP error occurs. Do not run the general diagnostic while the local SerpApi limit is full.

To separate authentication/model access from the extraction schema, run `TRIPWISE_LIVE_DIAG=YES TRIPWISE_DIAG_GEMINI_SIMPLE=YES npm run diagnose:live` **once**. This sends only `Reply OK.` to Gemini, with no structured output, and skips SerpApi. If it returns HTTP 200 with `extracted: true`, run the Gemini-only structured diagnostic once to inspect the exact 400 field error. A configured key or an HTTP response alone is not proof that preference extraction works.

Gemini, SerpApi prices and SerpApi community search are **never called automatically**. Click **Analyze with AI**, **Check Live Prices**, or **Find Reddit discussions** respectively. Slider changes are local only. With no key or a failed request, local rule matching and modeled recommendations remain available, with a visible error or unavailable label. Legacy optional Ollama and OpenAI paths remain; Gemini takes priority when configured.

## What the app does

1. Enter a supported departure city, future date, 2–7 days, 1–4 people and a **whole-group** USD budget. Local rules immediately extract interests and hard limits; Gemini can optionally return structured interests, styles, limits, spending priorities, suggested score weights, ambiguities and a short explanation. The form's numeric values win conflicts, which must be confirmed. Successful AI analysis updates the displayed tags and recomputes existing results after conflicts are resolved; it does not supply prices.
2. The existing local engine screens all 40 destination profiles. Strict Budget excludes over-budget midpoint estimates from Best Fits; No Flights, No Rental Car and No Layovers are separate constraints. Unknown routes remain unverified. Four normalized sliders and presets change the score and ranking without overriding hard limits.
3. **Check Live Prices** requests up to two currently leading eligible/near-budget destinations; **Check this trip’s live prices** requests one selected card. The buttons show loading/success/partial/failure/quota states. A flight quote needs an outbound result and a selected return result via SerpApi `departure_token`; hotel data needs a matching full-stay total for the selected dates and guest count. A three-day trip uses two hotel nights. Missing leg, mismatched dates/currency/passengers, uncertain room count or absent total leaves the quote incomplete. Groups of 3–4 skip hotel search because this integration cannot confirm multiple rooms. Rail corridors skip flight search and show a separate operator link; train fares are never called live. A returned ticket price for multiple travelers is displayed, but its group total remains provisional and does **not** rerank budget feasibility. Only a complete comparable quote can change price-based ranking.
4. Expanding a card shows the existing cost/score breakdown, a **Live Travel Prices** note, sourced planning notes and manual community voices. **Find Reddit discussions** makes one explicit Google Search via SerpApi request for that destination. Search previews have links, retrieval times and keyword-based topic labels; they are **not** verified Reddit quotations, a consensus summary or high-upvote posts. No Reddit comments, usernames, vote counts or engagement figures are invented. A separate Google search link lets users inspect publicly indexed Xiaohongshu pages themselves; the app does not scrape them.
5. Compare up to three places. The comparison table shows feasibility, quote-supported total where present, demo total, data confidence and trade-offs.

## Price and source labels

| Label | Meaning |
| --- | --- |
| **Live Price** | Flight or hotel quote returned by a user-triggered SerpApi response in this server session. One itinerary/property only; it may change or disappear. |
| **Cached Price** | Same quote from a local in-memory cache less than six hours old. Restarting the server clears this cache. |
| **Modeled Estimate** | Original local distance, lodging and daily-spend assumptions. Always separate from API quotes; never live booking data. |
| **Unavailable / Unverified** | No complete matching quote or route evidence. No budget claim is made from missing supplier data. |

For a one-traveler complete flight + hotel quote, the app can calculate a **quote-supported cost** from the selected round-trip ticket and hotel's full-stay total. For multiple travelers, SerpApi labels the flight number as a ticket price but does not explicitly specify its per-person basis in the response schema; the displayed multiplication is **provisional**, the full group price is **Unknown**, and the demo ranking remains in force. **Estimated Costs** are modeled local spending plus a 10% safety buffer. Hotel rates are one property's offer, not a citywide norm. A property's link may not preserve its quoted rate. Airline baggage, taxes, booking fees, hotel room capacity and local transfers may change the actual bill. Neither returned amount guarantees booking availability. The selected return response is never added to the outbound response price.

SerpApi's official MCP endpoint is used with Bearer authentication in a server header, keeping its key out of URLs. See [official MCP integration](https://serpapi.com/integrations/mcp), [Flights API](https://serpapi.com/google-flights-api), and [Hotels API](https://serpapi.com/google-hotels-api). Gemini uses its official `generateContent` structured JSON format and `x-goog-api-key` header; see [API reference](https://ai.google.dev/api/generate-content) and [Models API](https://ai.google.dev/api/models). The endpoints are implemented and fixture-tested; real account access and output have **not** been verified in this development environment.

## Search budget and cache

- SerpApi requests use a persistent local counter at ignored `data/.serpapi-usage.json`. The default limit is **8 search requests per UTC day** (`SERPAPI_DAILY_LIMIT` can lower it). It counts attempted searches conservatively and stops when reached. This is **not** the account's official remaining credit balance.
- A full round trip normally costs **two flight searches** (outbound + token-selected return) and **one hotel search** per destination. Checking two destinations can therefore use **up to 6 SerpApi searches**. If a route lacks an airport mapping or the outbound result lacks a token, fewer searches occur. One community discussion check usually uses **one** additional search. Refresh deliberately bypasses the local cache and may consume the same amount again; it stops at the local daily limit.
- Price results cache for six hours; discussion results for 24 hours. Identical in-flight requests are deduplicated. Cache is in memory; the daily request counter survives restarts. SerpApi may also have its own cache, but this app counts every request it sends and does not claim official credit savings.
- No bulk search across 40 destinations, automatic purchase, paid subscription, Google Cloud Billing activation or background query is implemented.

## Data and community policy

- Forty destinations, city traits, season notes, no-car suitability, local spending and modeled transport costs are curated demo data. The source badge describes each fact's evidence, not the entire destination. Official Amtrak/LA Metro corridor pages support only route coverage, not date-specific fare or timetable. Short-range weather may use the free US National Weather Service API on detail expansion; failure shows a seasonal note.
- Wikimedia Commons photo authors and licenses remain in each card and in [image attribution](docs/image-attribution.md). There are currently no local JPEGs in `assets/destinations`; a browser may load the Commons fallback when online, otherwise the illustration remains.
- `data/xiaohongshu_manual_quotes.json` and `data/reddit_manual_quotes.json` ship empty. To add a manually checked, permitted short excerpt, append an object with `destination`, `quote`, `theme`, `date`, `noteTitle` and direct `sourceLink`. The server validates format/domain but cannot establish that a post actually contains the text. Recheck source, context, reuse permission and deletion status yourself. Xiaohongshu is manual only; there is no login bypass or automated scraping.
- SerpApi community results contain actual search result title, URL, optional search date and Google snippet. The snippet is labeled **search preview**, not a verified Reddit comment. No high-engagement badge appears without a licensed engagement source. Google Reviews of individual venues are not implemented.

See [data sources and limits](docs/data-sources.md) and the [technical implementation](../02-说明文档/技术实现说明.md). The original product plan and development plan are retained. No personal process narrative has been generated.

## Known limits

The API integration and error paths pass mock tests. The configured key previously received a real HTTP 200 from a **simple** Gemini request. The earlier structured request returned HTTP 400 because `responseFormat.text.mimeType` used the wrong enum value; the request now uses `APPLICATION_JSON`, but a full structured request is **not live-verified**. This development environment currently returns DNS `ENOTFOUND` for both API hosts and cannot reach its own 4173 listener, so no live endpoint was retested here. A prior user-run SerpApi Flights diagnostic reported real HTTP 200 with an extractable outbound result; a complete return leg and multi-traveler group fare remain unverified. Hotels and Reddit search were not called in this pass: the local SerpApi counter is 8/8 for 2026-10-16 UTC and resets at 00:00 UTC. That is not the provider balance. Restart the Node server, verify `/api/data/status` shows the release above, then click Analyze with AI once on your Mac. Do not claim a live hotel or community result until a source-linked result appears. Only mapped exact city airports are searched; regional destinations with no reliable airport mapping remain unavailable. No live rail/coach fare, verified whole-trip price or community popularity metric is available.
