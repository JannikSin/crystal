# Crystal

A small installable web app (PWA): a personal command center in six tabs on a
phone. Today (a vertical day timeline with checkboxes), News (a ranked daily
news edition), Markets (an evening market digest as a ticker terminal), Money
(a portfolio and account ledger), Career (a company dossier with a daily
outreach slip), Listen (a podcast and audiobook queue).

This repo is only the app shell: HTML, CSS, JS, icons. It contains no content
and no personal data. At runtime the app fetches everything as JSON from a
private Cloudflare Worker, authenticated with a key the user pastes once
(stored in localStorage on the device). Checkbox state, story read-state, and
free-text capture notes are posted back to the same Worker through one
offline-safe queue; photos and voice recordings go through a separate
IndexedDB-backed uploader so a large media file can never block a checkbox.

## v4 (2026-08-08)

v4 replaced the single 1,350-line `app.js` with ES modules, no build step, and
gave each tab its own layout language:

- `index.html`: shell, tab bar, and the meta Content-Security-Policy. No inline
  script (the service worker registers from `app.js`).
- `app.css`: one commented section per tab.
- `core.js`: storage, markdown, dates, `api()`, the key screen, shared furniture.
- `sync.js`: the outbound JSON queue plus the IndexedDB `uploads` blob store and
  its own upload pump.
- `reward.js`: the earned-fun engine, a pure function (see `tools/test_reward.mjs`).
- `today.js` `news.js` `markets.js` `money.js` `career.js` `listen.js`: one tab each.
- `app.js`: the router table and boot.
- `sw.js`: offline shell cache, precaching every file above. The cache name carries the version; sw.js itself documents when to bump it. Do not quote a number here, it goes stale the moment someone deploys.

Brief payloads carry `v: 2` (a timeline). Anything without it renders through
the old card board, so cached history days keep working.

### Key split

The Worker takes two roles on the `x-brief-key` header, and only that header
(there is no `?key=` path):

- `BRIEF_KEY` / `BRIEF_KEYS`: the laptop. Every route, including pushing
  payloads and reading or deleting recorded audio.
- `PHONE_KEY` / `PHONE_KEYS`: this app. GET on payload routes, POST on
  `/ticks`, `/capture`, `/newsread`, `/scan`, `/answer`. Nothing else.

Both accept a comma separated set so a key can rotate without a window of 401s.
Put the phone key in the app, never the laptop key.

### Purge runbook

Media and grades carry a 14 day TTL, so they expire on their own. To wipe them
now:

```
wrangler kv key list --binding STORE | jq -r '.[].name | select(startswith("scan:") or startswith("answer:"))' > purge.json
wrangler kv bulk delete --binding STORE purge.json
```

Single key: `wrangler kv key delete --binding STORE "scan:2026-08-08"`.
On the phone, the footer's "Forget this phone" wipes the key, every cached
payload, the upload store and the shell caches in one tap.

## Files

- `worker/`: the Cloudflare Worker (KV-backed, key-gated). Deploy with
  wrangler; keys live only as Worker secrets. Serves the brief, news, markets,
  holdings, listen and career payloads, the scan and answer blob routes, the
  feedback route, and quotes relayed from a public price provider (Yahoo chart
  API with Stooq CSV fallback, KV-cached, stale-served on provider failure).
- `worker/src/validate.js`: payload contracts, enforced on POST.
- `tools/test_schemas.mjs`: contract self-check (`node tools/test_schemas.mjs`).
- `tools/test_reward.mjs`: reward engine self-check (`node tools/test_reward.mjs`).
- `tools/make-icons.mjs`: zero-dependency icon generator.

## Hard rule

No personal data in this repo, ever: no names, no schedules, no holdings, no
keys. Content exists only in the Worker's KV at runtime.
