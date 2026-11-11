// clockcore.js: the day clock's arithmetic, pure. No DOM, no storage, no clock
// beyond the `now` handed in, so tools/test_clock.mjs runs it in node.
//
// The model is a SWITCH LOG, not a list of blocks. Every entry says "from this
// moment I am doing X" ({id, at: epoch ms, cat, sub?}). A block is the stretch
// from one switch to the next, so the day can never have a gap or an overlap,
// and fixing a forgotten switch is moving one timestamp, not repairing two
// blocks. The running activity is simply the last switch.

export const WEEK_TARGET_H = 60; // David, 2026-11-09: "a 12 hr work day 5 days a week"
export const DAY_TARGET_H = 12;

// Default categories. `work` decides what counts toward the 60 hours. Course
// tags for homework are NOT here (this repo carries no personal data, DOCTRINE
// Article 1); they arrive from the Worker's /clockconfig, pushed by the laptop.
export const DEFAULT_CATS = [
  { id: "class", label: "Class", work: true },
  { id: "hw", label: "Homework", work: true, subs: true },
  { id: "purpl", label: "PURPL", work: true },
  { id: "zeng", label: "Zeng", work: true },
  { id: "jobs", label: "Job search", work: true },
  { id: "clubs", label: "TTP / ASME", work: true },
  { id: "gym", label: "Gym", work: false },
  { id: "meals", label: "Meals", work: false },
  { id: "commute", label: "Commute", work: false },
  { id: "social", label: "Social", work: false },
  { id: "phone", label: "Instagram / phone", work: false },
  { id: "chores", label: "Chores / errands", work: false },
  { id: "rest", label: "Break / other", work: false },
  { id: "sleep", label: "Sleep", work: false },
];

export function catOf(cats, id) {
  return cats.find((c) => c.id === id) || { id, label: id, work: false };
}

// Sort, drop exact duplicates of time, and collapse a switch into the same
// activity it was already doing (tapping PURPL twice is one block, not two).
export function normalize(log) {
  const s = (log || []).filter((e) => e && Number.isFinite(e.at) && e.cat)
    .slice().sort((a, b) => a.at - b.at);
  const out = [];
  for (const e of s) {
    const prev = out[out.length - 1];
    // Same instant: the later entry wins. Drop the earlier one and compare
    // again against what is now last, so the result never holds two adjacent
    // entries of one activity (normalize(normalize(x)) equals normalize(x)).
    if (prev && prev.at === e.at) out.pop();
    const p = out[out.length - 1];
    if (p && p.cat === e.cat && (p.sub || "") === (e.sub || "")) continue;
    out.push(e);
  }
  return out;
}

export function current(log) {
  const n = normalize(log);
  return n.length ? n[n.length - 1] : null;
}

// Local midnight of the day that contains `ms`, and of the next day. Built
// from calendar fields, so a 23 h or 25 h DST day is still one day.
export function dayBounds(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

// The blocks that overlap [from, to), clipped to it. The last switch runs
// until `now` (never past it: the future is not tracked time).
export function blocks(log, from, to, now) {
  const n = normalize(log);
  const out = [];
  for (let i = 0; i < n.length; i++) {
    const start = n[i].at;
    const end = i + 1 < n.length ? n[i + 1].at : now;
    const a = Math.max(start, from), b = Math.min(end, to, now);
    if (b > a) out.push({ id: n[i].id, cat: n[i].cat, sub: n[i].sub || "", start: a, end: b,
      ms: b - a, open: i + 1 === n.length, realStart: start });
  }
  return out;
}

// Milliseconds per category (and per "hw:<course>") over [from, to).
export function totals(log, from, to, now, cats) {
  const by = {};
  const subs = {};
  let work = 0, tracked = 0;
  for (const b of blocks(log, from, to, now)) {
    by[b.cat] = (by[b.cat] || 0) + b.ms;
    if (b.sub) subs[b.cat + ":" + b.sub] = (subs[b.cat + ":" + b.sub] || 0) + b.ms;
    tracked += b.ms;
    if (catOf(cats, b.cat).work) work += b.ms;
  }
  return { by, subs, work, tracked };
}

// Monday of the week containing iso (weeks run Monday to Sunday, so the
// Sunday review closes a whole week).
export function weekStart(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - back);
  return isoFromDate(dt);
}
export function isoFromDate(dt) {
  const p = (x) => (x < 10 ? "0" : "") + x;
  return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
}
export function addDays(iso, k) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoFromDate(new Date(y, m - 1, d + k));
}

// ---------- edits ----------
// Every edit returns a NEW log, normalized. The UI never mutates in place.

// "I started this N minutes ago": move the latest switch back, but never to or
// before the switch it follows, which would swallow that block entirely.
// `now` (optional) is a ceiling too: a start time is never in the future.
export function backdate(log, id, at, now) {
  const n = normalize(log);
  const i = n.findIndex((e) => e.id === id);
  if (i < 0) return n;
  const floor = i > 0 ? n[i - 1].at + 60000 : -Infinity;
  const ceil = Math.min(i + 1 < n.length ? n[i + 1].at - 60000 : Infinity, Number.isFinite(now) ? now : Infinity);
  if (floor > ceil) return n; // squeezed between two switches under 2 min apart: nowhere to move
  const t = Math.min(Math.max(at, floor), ceil);
  return normalize(n.map((e, k) => (k === i ? { ...e, at: t } : e)));
}

// Change what a block was (category and course tag).
export function recat(log, id, cat, sub) {
  return normalize(normalize(log).map((e) => (e.id === id ? { ...e, cat, sub: sub || "" } : e)));
}

// Delete a block: its time folds into the block before it.
export function remove(log, id) {
  return normalize(normalize(log).filter((e) => e.id !== id));
}

// "1:00 to 2:00 pm was the gym, I forgot to tap." Paint [start, end) as cat:
// every switch inside the window goes, and whatever was running at `end`
// before the edit resumes at `end`, so the rest of the day is untouched.
export function paint(log, start, end, cat, sub, mkId, now) {
  const n = normalize(log);
  if (!(end > start)) return n;
  const stop = Math.min(end, now);
  let resume = null;
  for (const e of n) if (e.at < stop) resume = e;
  const kept = n.filter((e) => e.at < start || e.at >= stop);
  kept.push({ id: mkId(), at: start, cat, sub: sub || "" });
  if (stop < now && resume && !n.some((e) => e.at === stop)) {
    kept.push({ id: mkId(), at: stop, cat: resume.cat, sub: resume.sub || "" });
  }
  return normalize(kept);
}

// ---------- typed times ----------
// A time input gives "HH:MM" with no date. Typed at 7 am, "23:00" means last
// night, not tonight: the latest moment with that reading at or before `now`.
export function lastAt(hhmm, now) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  return t <= now ? t : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, h, m).getTime();
}
// The first moment after `start` that reads "HH:MM" (an end time: 11:30 pm to
// 1:00 am ends on the next calendar day).
export function endAfter(start, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(start);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  return t > start ? t : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m).getTime();
}

// ---------- the idle catch ----------
// The failure mode of every manual timer is forgetting to switch. So a block
// that has run past its ceiling asks, the next time the app is opened, whether
// it is still true. `okAt` is when he last said "still on it".
export function ceilingMs(cat) {
  return cat === "sleep" ? 11 * 3600e3 : cat === "class" ? 3 * 3600e3 : 3 * 3600e3;
}
export function needsCheck(log, now, okAt) {
  const c = current(log);
  if (!c) return null;
  const since = Math.max(c.at, okAt || 0);
  return now - since >= ceilingMs(c.cat) ? c : null;
}

// ---------- the sync snapshot ----------
// One self-contained record per local day, posted whole and replacing the
// last one, so a dropped post is healed by the next and the laptop never has
// to merge deltas. `start` is what was running at midnight.
export function snapshot(log, iso, extras) {
  const [from, to] = dayBounds(iso);
  const n = normalize(log);
  let start = null;
  for (const e of n) if (e.at < from) start = e;
  const events = n.filter((e) => e.at >= from && e.at < to)
    .map((e) => ({ at: e.at, cat: e.cat, sub: e.sub || "" }));
  return {
    date: iso,
    tz: -new Date(from).getTimezoneOffset(),
    start: start ? { cat: start.cat, sub: start.sub || "", at: start.at } : null,
    events,
    ig: extras && Number.isFinite(extras.ig) ? extras.ig : null,
  };
}

// The reverse: day snapshots (what the Worker holds) back into one switch log,
// for a phone whose storage was wiped. Same rule as crystal_clock.py switches().
export function rebuild(days, mkId) {
  const ds = (days || []).filter((d) => d && d.date).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const at = new Map();
  const put = (e) => { if (e && Number.isFinite(e.at) && e.cat) at.set(e.at, { id: mkId(), at: e.at, cat: e.cat, sub: e.sub || "" }); };
  if (ds.length) put(ds[0].start);
  for (const d of ds) for (const e of d.events || []) put(e);
  return normalize([...at.values()]);
}

// ---------- words ----------
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + "h " + r + "m" : h + "h";
}
export function fmtHours(ms) {
  const h = ms / 3600e3;
  return Math.round(h * 10) / 10 + " h"; // one decimal always: 11.6 of 12 must not read as 12
}
export function fmtClock(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes(), ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
}
