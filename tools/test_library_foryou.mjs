// Self-check for library.js learn() + forYou(): what the Library opens on. A note is new when it ARRIVED on
// this phone in the last 7 days (not when it was last rewritten: the boards are rewritten hourly), sits in
// one of David's folders (not Sessions, System or Lanes), and has not been opened. The first run baselines
// everything already there.
//
//     node tools/test_library_foryou.mjs
import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null, querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { learn, forYou } = await import("../library.js");

const today = new Date("2026-10-18T14:00:00");
const n = (id, folder, updated = "2026-10-18") => ({ id, folder, updated, title: id, body: "x" });
const before = [n("tasks", "Start here"), n("stock", "Money"), n("old-paper", "Papers", "2026-09-01")];

// first run: everything already there is the baseline, nothing is "new"
const known = learn(before, {}, "2026-10-18");
assert.deepEqual(forYou(before, {}, known, today), [], "baseline: the hourly boards are not new");

// later: two write-ups and a session note arrive; a board is rewritten again
const later = before.concat([n("fitz-report", "Papers"), n("scholarships", "Money"), n("kenai", "Sessions")]);
learn(later, known, "2026-10-19");
const day2 = new Date("2026-10-19T09:00:00");
assert.deepEqual(forYou(later, {}, known, day2).map((x) => x.id).sort(), ["fitz-report", "scholarships"],
  "only arrivals in his folders");
assert.deepEqual(forYou(later, { "fitz-report": 1 }, known, day2).map((x) => x.id), ["scholarships"],
  "opened: off the list");
assert.deepEqual(forYou(later, {}, known, new Date("2026-10-27T09:00:00")), [], "older than a week: off the list");
console.log("library for-you: all checks passed");
