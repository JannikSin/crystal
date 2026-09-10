// Self-check for the interview rep QUEUE, the thing that lets him do three
// questions in one sitting instead of one a day (David, 2026-09-07).
//
// The rule that matters: a question he already recorded must never be handed
// back. The grader runs on the laptop hours later, so the archive cannot be
// what enforces that on the phone; the device's own answered map is. Getting
// this wrong means he taps NEXT QUESTION and gets the one he just did.
//
// today.js imports core.js, which touches document at module scope. Same three
// stubs as test_sync.mjs, and the function under test is pure.
//
//     node tools/test_reps.mjs
import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} };
// node 24 defines navigator as a getter, so it is patched rather than replaced
if (!globalThis.navigator.serviceWorker) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", { value: { addEventListener() {} }, configurable: true });
}

const { repQueue } = await import("../today.js");

const card = {
  qid: "q20",
  queue: [
    { qid: "q20", q: "Bernoulli" },
    { qid: "q21", q: "Three modes" },
    { qid: "q22", q: "Regen cooling" },
  ],
};

// ---------- the ordinary day ----------
let out = repQueue(card, {});
assert.equal(out.length, 3, "a fresh card serves the whole queue");
assert.equal(out[0].qid, "q20", "the head is the card qid");
assert.equal(out[2].q, "Regen cooling", "question text rides along");

// ---------- he answered the first one an hour ago ----------
out = repQueue(card, { q20: "2026-09-07" });
assert.equal(out.length, 2);
assert.equal(out[0].qid, "q21", "an answered question is skipped, not re-served");

// ---------- he did the whole sitting ----------
out = repQueue(card, { q20: "2026-09-07", q21: "2026-09-07", q22: "2026-09-07" });
assert.equal(out.length, 0, "nothing left is an empty queue, not a repeat");

// ---------- an answer recorded on an earlier day still counts ----------
out = repQueue(card, { q21: "2026-08-30" });
assert.deepEqual(out.map((x) => x.qid), ["q20", "q22"], "the map is not date-scoped");

// ---------- an old brief, cached before the queue existed ----------
out = repQueue({ qid: "q9" }, {});
assert.deepEqual(out, [{ qid: "q9", q: "" }], "a queueless card still records one answer");
out = repQueue({ qid: "q9" }, { q9: "2026-08-27" });
assert.equal(out.length, 0, "and still respects the answered map");

// ---------- junk in the payload must not become a dead card ----------
out = repQueue({ qid: "q20", queue: [{ qid: "q20", q: "a" }, { q: "no qid" }, null, { qid: "q20", q: "dupe" }] }, {});
assert.deepEqual(out.map((x) => x.qid), ["q20"], "entries with no qid, nulls and duplicates are dropped");
out = repQueue({}, {});
assert.deepEqual(out, [], "a card with neither qid nor queue yields nothing, and does not throw");
out = repQueue({ qid: "q20", queue: [] }, {});
assert.deepEqual(out.map((x) => x.qid), ["q20"], "an empty queue falls back to the card qid");

console.log("today.js: rep queue checked, all assertions passed");
