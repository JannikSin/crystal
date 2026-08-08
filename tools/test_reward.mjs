// Self-check for reward.js, the one piece of client logic with real branching.
// Run: node tools/test_reward.mjs
import assert from "node:assert/strict";
import { computeReward, UNTIL } from "../reward.js";

const base = {
  v: 2,
  date: "2026-08-08",
  timeline: [
    { id: "a", floor: true },
    { id: "b", floor: true },
    { id: "c", floor: true },
    { id: "work", tier: "work" },
    { id: "fun-taken", tier: "flex", kind: "fun" },
  ],
  reward: {
    dailyPick: "Top of the queue",
    dailyAlt: ["An episode", "An hour of a game"],
    fullPick: "The Odyssey in 70mm.",
    weeklyCountdown: null,
    monthlyCountdown: null,
    outstanding: null,
    procurement: null,
  },
};
const none = { daily: false, full: false };
const all = (ids) => Object.fromEntries(ids.map((i) => [i, true]));
// the clock is injected, so these assertions do not change meaning at 22:01
const noon = new Date("2026-08-08T12:00:00");
const late = new Date("2026-08-08T22:30:00");

// v1 payloads have no reward layer at all
assert.deepEqual(computeReward({ v: 1 }, {}, none, 0, noon).pick, null);

// floor not clear: nothing is granted, and nothing nags about it
let r = computeReward(base, all(["a", "b"]), none, 0, noon);
assert.equal(r.pick, null);
assert.equal(r.lines.length, 0);
assert.equal(r.latch.daily, false);

// the third floor box flips: the grant fires the same evening
r = computeReward(base, all(["a", "b", "c"]), none, 0, noon);
assert.ok(r.pick.text.startsWith("Cleared. Top of the queue."));
assert.ok(r.pick.text.includes(UNTIL));
assert.equal(r.pick.swappable, true);
assert.equal(r.latch.daily, true);

// swap is a render choice: it rotates and never touches the latch
assert.ok(computeReward(base, all(["a", "b", "c"]), none, 1, noon).pick.text.includes("An episode"));
assert.ok(computeReward(base, all(["a", "b", "c"]), none, 3, noon).pick.text.includes("Top of the queue"));

// the reveal LATCHES: unticking a floor box never takes the evening back
r = computeReward(base, all(["a"]), { daily: true, full: false }, 0, noon);
assert.ok(r.pick && r.pick.text.includes("Top of the queue"));

// the grant expires at 22:00 and never banks: nothing renders after it, but
// the day still counted as cleared
r = computeReward(base, all(["a", "b", "c"]), none, 0, late);
assert.equal(r.pick, null);
assert.equal(r.latch.daily, true);

// a FULL day upgrades the size of the suggestion, never whether
r = computeReward(base, all(["a", "b", "c", "work", "fun-taken"]), none, 0, noon);
assert.ok(r.pick.text.includes("The Odyssey"));
assert.equal(r.pick.swappable, false);
assert.equal(r.latch.full, true);

// an untaken fun item is the grant itself, never work owed: it must not be the
// one thing holding the whole-day pick shut
r = computeReward(base, all(["a", "b", "c", "work"]), none, 0, noon);
assert.equal(r.latch.full, true);
assert.ok(r.pick.text.includes("The Odyssey"));

// countdowns render only inside the window, and only as words
const cd = (w, m) => computeReward(
  { ...base, reward: { ...base.reward, weeklyCountdown: w, monthlyCountdown: m } },
  {}, none, 0, noon).lines.map((l) => l.text);
assert.deepEqual(cd(5, 9), []);
// the exact idiom, matched word for word by daily.py's reward card
assert.equal(cd(2, null)[0], "Two more on the floor and Saturday is live.");
assert.equal(cd(1, null)[0], "One more on the floor and Saturday is live.");
assert.equal(cd(null, 4)[0], "Four more and the whole day comes into range.");
assert.deepEqual(cd(0, 0), []); // already live is not a countdown

// no banned vocabulary anywhere in what this renders
const banned = /streak|perfect|failed|reset|broken|missed|earned|unlocked|%/i;
const strings = []
  .concat(cd(1, 1))
  .concat(computeReward(base, all(["a", "b", "c"]), none, 0, noon).pick.text)
  .concat(computeReward(base, all(["a", "b", "c", "work", "fun-taken"]), none, 0, noon).pick.text)
  .concat(computeReward({ ...base, reward: { ...base.reward,
    procurement: "Saturday 2pm, the courts. Booked?",
    outstanding: { pick: "Saturday 2pm, the courts.", expires: "2026-08-15" } } },
    {}, none, 0, noon).lines.map((l) => l.text));
strings.forEach((s) => assert.equal(banned.test(s), false, "banned wording in: " + s));

// em dashes are a house foul
strings.forEach((s) => assert.equal(s.includes("—"), false, "em dash in: " + s));

console.log("reward.js: " + strings.length + " rendered strings checked, all assertions passed");
