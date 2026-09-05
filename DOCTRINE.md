# Crystal (the app): the doctrine

> [!warning] **This is a v1 doctrine, and the standard moved on 2026-08-29.**
> Everything below is true and came out of this app's own history, so none of it is wasted. But the
> six-article shape was invented rather than researched, and the research (Amazon tenets, Nygard's
> Architecture Decision Records, design-doc non-goals) says these are **three documents, not one**.
> **What changes:** the prohibitions become *invariants* with a test named against each, the
> "settled" list becomes numbered decision records that can be marked *superseded* instead of
> silently going stale, the failure table becomes an incidents file, and the doctrine itself is
> capped at one page. **Awaiting David's review and go.** Standard: Crystal `System/App-Doctrine.md`.

**What this file is.** The governing principles of this app: what it is for, what
it will never do, which decisions are already settled, and how to tell a good
change from a bad one. `README.md` says how it is built and how to run it. **This
says what is true regardless of the code**, and it outranks the README where they
disagree. Crystal `System/Protocol.md` governs the vault; this governs the app
that reads it.

Written 2026-08-28 (session **trinity**) under the standard David set that day.
Shape: Crystal `System/App-Doctrine.md`.

---

## Article 0. The job

**Crystal is the phone surface for a life that is planned on a laptop: it is
where the day, the news, the markets, the money, the career slip and the listen
queue arrive, so David does not have to hold any of it in his head or hunt for it
in Obsidian.**

It is one of exactly **two function apps** in the portfolio; everything else is a
passion app with no daily obligation. That status is what earns it the daily
pipeline behind it.

**The app is the glance; the vault is the long version.** Every tab has a fuller
document behind it, and the tab's job is to make the fuller document unnecessary
most mornings.

---

## Article 1. The condition that shapes everything

**Everything real lives on the other side of a key, and nothing real lives in
this repo.**

This repo is a shell: HTML, CSS, JS, icons. **No personal data, ever.** No names,
no schedules, no holdings, no keys. Content exists only in the Worker's KV at
runtime, fetched with a key the user pastes once.

The second condition is that **he uses it in bursts, retroactively, on a phone,
often with no signal.** Forty-seven ticks across ten of twenty-three days, all
from the phone, all after the fact, ten of them in nineteen seconds. Every write
surface is built for that and nothing may require same-day fidelity.

---

## Article 2. What Crystal will never do

1. **Never put personal data in this repo.** Article 1. It is the one rule a
   later commit cannot undo.
2. **Never let a large media file block a small write.** Two pipes, deliberately
   separate: an outbound JSON queue for ticks, captures and grades, and an
   IndexedDB-backed uploader with its own pump for photos and recordings. A 6 MB
   recording may never wedge a checkbox.
3. **Never destroy a rejected write and report success.** *(Standing defect, see
   the open item below. Oberth cites this behaviour as a counter-example, and
   until it is fixed this article is an intention rather than a fact.)*
4. **Never accept the laptop key in the app.** The Worker splits roles on the
   `x-brief-key` header and only that header; there is no `?key=` path.
   `BRIEF_KEY` is the laptop and reaches every route including deleting recorded
   audio. `PHONE_KEY` is this app: GET on payloads, POST on `/ticks`, `/capture`,
   `/newsread`, `/scan`, `/answer`, nothing else. **Put the phone key in the app,
   never the laptop key.**
5. **Never show a number, a percent, a ring, a bar, or red on the earned-fun
   surface**, and never the words *streak, perfect, failed, reset, broken,
   missed, earned, unlocked*. Council rule, baked into `reward.js`.
6. **Never take back a granted evening.** Reveals latch: unticking a box does not
   revoke it. The daily grant expires at 22:00 and never banks.
7. **Never break a cached history day.** Brief payloads carry `v: 2`; anything
   without it renders through the old card board, so days already on the phone
   keep working.

---

## Article 3. Settled. Do not re-litigate

- **Six tabs, one layout language each.** Today is a vertical day timeline, News
  a ranked edition, Markets a ticker terminal, Money a ledger, Career a dossier
  with a daily slip, Listen a queue. The v4 rebuild (2026-08-08) replaced one
  1,350-line `app.js` with ES modules and no build step; do not reconsolidate.
- **The earned-fun gate is the sleep FLOOR** (items with `floor: true`), never the
  whole board. Countdowns render only when close: two weekly, four monthly.
- **`reward.js` is a pure function.** No DOM, no storage, no clock beyond what is
  handed in, so `tools/test_reward.mjs` runs it in node. The pipeline owns
  everything dated before today; this owns exactly one thing, the same-evening
  daily unlock. Keep it pure.
- **Payload contracts are enforced on POST** in `worker/src/validate.js`, with a
  contract self-check in `tools/test_schemas.mjs`.
- **Quotes are relayed, cached and stale-served:** Yahoo chart API with a Stooq
  CSV fallback, KV-cached, stale on provider failure. A missing quote degrades to
  an old one, never to a blank.
- **Media and grades carry a 14-day TTL** so they expire on their own, and
  "Forget this phone" wipes the key, every cached payload, the upload store and
  the shell caches in one tap.
- **No inline script;** the service worker registers from `app.js`, and the CSP
  lives in `index.html`.

---

## Article 4. How to tell a good change from a bad one

1. **Does anything personal enter this repo?** Stop.
2. **Which of the two pipes does this write use, and can it block the other?**
3. **Does it still render a payload cached three days ago?**
4. **Does it work having not been opened since Tuesday?**
5. **`node tools/test_schemas.mjs` and `node tools/test_reward.mjs` green**, then
   open it on the phone and press the thing.
6. **Bump the cache name in `sw.js`** and add any new file to the precache list.

---

## Article 5. The failure modes this app is armed against

| Failure | What happened | The armour |
|---|---|---|
| A media blob wedging a tick | one queue for everything | two pipes, separate pumps |
| A key with too much reach on a lost phone | one key for laptop and phone | the `BRIEF_KEY` / `PHONE_KEY` split |
| A quantified habit surface reading as judgement | the council's own finding | no numbers, no percentages, banned vocabulary |
| A revoked reward | unticking took an evening back | reveals latch |
| A schema change breaking cached days | a new payload shape | `v: 2` with a fallback renderer |
| Media accumulating on a server | scans and recordings | 14-day TTL plus a one-tap purge |

---

## Article 6. The open item this doctrine will not paper over

**`sync.js` drops the queue head on any 4xx except 401, then recurses, finds an
empty queue, and stamps the word "synced" on the screen.** A record the Worker
rejected is destroyed and the interface reports success. The Worker's own source
carries a comment proving someone found this and hardened exactly one route
(`/desk`) against it, **leaving `/ticks` live**. Found by the 2026-08-24 council.

**Oberth does not inherit this**: it moves a rejected delta to a visible dead
letter and says so in words. The fix is to bring that behaviour back here, and
until it lands, Article 2.3 is an intention.

---

## Article 7. Kill conditions

**Not applicable, and that is deliberate.** Crystal is one of the two function
apps and the daily pipeline reports into it. If Crystal stops being used, the
problem is the pipeline, not the app, and the review belongs on the automation
registry: Crystal `System/Automations.md`.

---

*Companion documents: `README.md` (build and run, key split, purge runbook),
Crystal `System/Protocol.md` (the vault it reads), Crystal
`System/App-Doctrine.md` (this shape).*
