// Self-check for episode.js pick(): which audio rows each shelf shows. NEWS
// must show today's news episode and nothing else (David, 2026-10-18: "it would
// just be that day. I wouldn't see any other days"); Listen > Audio shows all.
//
// episode.js imports core.js, which touches document at module scope. One
// stub and it runs in node; pick() is pure.
//
//     node tools/test_episode_scope.mjs
import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { pick } = await import("../episode.js");

const T = "2026-10-18";
const items = [
  { id: "news-2026-10-18", kind: "news", date: T, built: "2026-10-18T12:20:00-04:00" },
  { id: "news-2026-10-18-duet", kind: "news", date: T, built: "2026-10-18T12:10:00-04:00" },
  { id: "news-2026-10-17-duet", kind: "news", date: "2026-10-17", built: "2026-10-17T07:33:05-05:00" },
  { id: "daily-2026-10-18", kind: "daily", date: T, built: "2026-10-18T07:30:00-04:00" },
];

assert.deepEqual(pick("all", items, T), items, "Listen shows every file");
assert.deepEqual(pick("news", items, T).map((m) => m.id), ["news-2026-10-18-duet"],
  "NEWS prefers today's duet over a newer one-narrator read");
assert.deepEqual(pick("news", items.filter((m) => !/duet/.test(m.id) || m.date !== T), T).map((m) => m.id),
  ["news-2026-10-18"], "no duet today: the single read");
assert.deepEqual(pick("news", items.filter((m) => m.date !== T || m.kind !== "news"), T), [],
  "no news episode today: nothing, never yesterday's");
const twoDuets = [
  { id: "news-2026-10-18-duet", kind: "news", date: T, built: "2026-10-18T08:00:00-04:00" },
  { id: "news-2026-10-18-duet", kind: "news", date: T, built: "2026-10-18T12:00:00-04:00" },
];
assert.equal(pick("news", twoDuets, T)[0].built, "2026-10-18T12:00:00-04:00", "newest build wins");
console.log("episode scope: all checks passed");
