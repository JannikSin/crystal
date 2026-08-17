// reward.js: the earned-fun engine, as a pure function.
//
// No DOM, no storage, no clock beyond what is handed in, so tools/test_reward.mjs
// can run it in node. The pipeline owns everything dated before today (windows,
// weekly and monthly grants); this owns exactly one thing, the same-evening
// daily unlock, computed from live tick state.
//
// House rules baked in here, from the council:
//   - the gate is the sleep FLOOR (items with floor:true), never the whole board
//   - the daily grant expires 22:00 and never banks
//   - reveals LATCH: unticking a box never takes a granted evening back
//   - countdowns render only when they are close (2 weekly, 4 monthly)
//   - no number, no percent, no ring, no bar, no red, and none of the words
//     streak / perfect / failed / reset / broken / missed / earned / unlocked

export const UNTIL = "22:00";

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];
const word = (n) => WORDS[n] || String(n);

// payload: the brief v2 object. doneMap: {id: true|false} already merged by the
// caller. latch: {daily, full} read from localStorage. swapIdx: ephemeral.
// now: the clock, injected so the 22:00 expiry is testable.
// Returns {lines:[], pick:{text, swappable}|null, latch:{daily, full}}.
// group rows (kind "group") hold their real items in children; what the day
// owes is the leaves. Mirrors flatItems in today.js, duplicated so this file
// stays DOM-free and node-testable with no imports.
function flat(items) {
  const out = [];
  (items || []).forEach((it) => {
    if (it.kind === "group") out.push(...flat(it.children));
    else out.push(it);
  });
  return out;
}

export function computeReward(payload, doneMap, latch, swapIdx, now) {
  const out = { lines: [], pick: null, latch: { daily: false, full: false } };
  if (!payload || payload.v !== 2) return out;
  const r = payload.reward || null;
  const items = flat(Array.isArray(payload.timeline) ? payload.timeline : []);
  const done = (it) => !!(doneMap && doneMap[it.id]);

  const floor = items.filter((it) => it.floor === true);
  const floorClear = floor.length > 0 && floor.every(done);
  // a fun item IS the grant, not work owed: an untaken one must never be the
  // reason the whole-day pick stays shut
  const owed = items.filter((it) => it.kind !== "fun");
  const allClear = owed.length > 0 && owed.every(done);

  const wasDaily = !!(latch && latch.daily);
  const wasFull = !!(latch && latch.full);
  out.latch.daily = wasDaily || floorClear;
  out.latch.full = wasFull || allClear;

  if (!r) return out;

  // countdowns: only when they are within reach, and only ever as words
  const wk = r.weeklyCountdown;
  if (typeof wk === "number" && wk > 0 && wk <= 2) {
    out.lines.push({
      text: word(wk) + " more on the floor and Saturday is live.",
      dim: false,
    });
  }
  const mo = r.monthlyCountdown;
  if (typeof mo === "number" && mo > 0 && mo <= 4) {
    out.lines.push({
      text: word(mo) + " more and the whole day comes into range.",
      dim: false,
    });
  }
  if (r.procurement) out.lines.push({ text: String(r.procurement), dim: false });
  if (r.outstanding && r.outstanding.pick) {
    out.lines.push({
      text: "Still standing: " + r.outstanding.pick +
        (r.outstanding.expires ? " Through " + r.outstanding.expires + "." : ""),
      dim: true,
    });
  }

  // The grant expires at 22:00 and never banks, so past that hour there is no
  // pick to render. The latch still stands: the day was still cleared.
  if ((now instanceof Date ? now : new Date()).getHours() >= 22) return out;

  // the pick. A full day upgrades the SIZE of the suggestion, never whether.
  if (out.latch.full && r.fullPick) {
    out.pick = { text: "Cleared. " + r.fullPick + " Until " + UNTIL + ".", swappable: false };
  } else if (out.latch.daily) {
    const picks = [r.dailyPick].concat(Array.isArray(r.dailyAlt) ? r.dailyAlt : []).filter(Boolean);
    if (picks.length) {
      const pick = picks[((swapIdx || 0) % picks.length + picks.length) % picks.length];
      out.pick = {
        text: "Cleared. " + pick + ". Until " + UNTIL + "." + (picks.length > 1 ? " Tap to swap." : ""),
        swappable: picks.length > 1,
      };
    }
  }
  return out;
}
