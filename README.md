# Crystal

A small installable web app (PWA): a personal command center in four tabs on
a phone. Today (a daily brief board with checkboxes), News (a ranked daily
news edition), Markets (an evening market digest), Money (a portfolio
dashboard with dials and charts).

This repo is only the app shell: HTML, CSS, JS, icons. It contains no content
and no personal data. At runtime the app fetches everything as JSON from a
private Cloudflare Worker, authenticated with a key the user pastes once
(stored in localStorage on the device). Checkbox state, story read-state, and
free-text capture notes are posted back to the same Worker through one
offline-safe queue.

- `index.html` + `app.js`: the whole app, no frameworks, no build step.
- `sw.js`: offline shell cache (content is kept in localStorage).
- `worker/`: the Cloudflare Worker (KV-backed, key-gated). Deploy with
  wrangler; the key lives only as a Worker secret. Serves the brief, news,
  markets, and holdings payloads, plus quotes relayed from a public price
  provider (Yahoo chart API with Stooq CSV fallback, KV-cached, stale-served
  on provider failure).
- `worker/src/validate.js`: payload contracts, enforced on POST.
- `tools/test_schemas.mjs`: contract self-check (`node tools/test_schemas.mjs`).
- `tools/make-icons.mjs`: zero-dependency icon generator.

## Hard rule

No personal data in this repo, ever: no names, no schedules, no holdings, no
keys. Content exists only in the Worker's KV at runtime.
