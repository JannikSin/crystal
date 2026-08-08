// Self-check for the merge rule in sync.js: which state wins when the payload
// the Worker built and the box the phone remembers disagree. Getting this
// backwards silently un-ticks a box the user ticked, so it gets a test.
//
// sync.js imports core.js, which touches document at module scope, and it
// registers window listeners of its own. Three stubs and it runs in node; the
// two functions under test are pure.
//
//     node tools/test_sync.mjs
import assert from "node:assert/strict";

globalThis.document = { getElementById: () => null };
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} };

const { isDone, newer } = await import("../sync.js");

// ---------- newer ----------
assert.equal(newer("2026-08-08T09:00:00", "2026-08-08T06:30:00"), true);
assert.equal(newer("2026-08-08T06:00:00", "2026-08-08T06:30:00"), false);
assert.equal(newer("2026-08-08T06:30:00", "2026-08-08T06:30:00"), false, "equal is not newer");
// the phone now stamps an offset; the laptop's build stamp has none
assert.equal(newer("2026-08-08T09:00:00-04:00", "2026-08-08T06:30:00-04:00"), true);
// unparseable on both sides falls back to string order, which the format allows
assert.equal(newer("2026-08-09", "2026-08-08"), true);

// ---------- isDone ----------
const built = "2026-08-08T06:30:00";
const item = { id: "sleep-lights-out", state: false };

assert.equal(isDone(item, {}, built), false, "nothing local, payload says not done");
assert.equal(isDone({ ...item, state: true }, {}, built), true, "payload state stands on its own");

// a local tick always wins: it is the newest thing that happened
assert.equal(isDone(item, { "sleep-lights-out": { done: true, at: "2026-08-08T09:00:00" } }, built), true);
assert.equal(isDone(item, { "sleep-lights-out": { done: true, at: "2026-08-07T09:00:00" } }, built), true);

// M2: an untick is a tombstone, and it only overrides a payload it POSTDATES.
// Newer than the build: the user changed their mind after the brief was made.
assert.equal(
  isDone({ ...item, state: true }, { "sleep-lights-out": { done: false, at: "2026-08-08T09:00:00" } }, built),
  false,
  "an untick after the build must not be undone by the payload",
);
// Older than the build: the pipeline has already seen it and said done anyway.
assert.equal(
  isDone({ ...item, state: true }, { "sleep-lights-out": { done: false, at: "2026-08-08T05:00:00" } }, built),
  true,
  "a stale untick loses to a build that came after it",
);
// no build stamp at all: the local record is all there is
assert.equal(
  isDone({ ...item, state: true }, { "sleep-lights-out": { done: false, at: "2026-08-08T05:00:00" } }, ""),
  false,
);

console.log("sync.js: merge rule checked, all assertions passed");
