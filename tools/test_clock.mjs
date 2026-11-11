// node tools/test_clock.mjs: the day clock's arithmetic (clockcore.js).
import * as C from "../clockcore.js";

let fails = 0, n = 0;
function eq(a, b, msg) {
  n++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.log("FAIL", msg, "\n  got ", JSON.stringify(a), "\n  want", JSON.stringify(b)); }
}
const H = 3600e3, M = 60e3;
const [d0, d1] = C.dayBounds("2026-11-09");
const at = (h, m = 0) => d0 + h * H + m * M;
let k = 0;
const id = () => "x" + (++k);
const ev = (h, m, cat, sub) => ({ id: id(), at: at(h, m), cat, sub: sub || "" });

eq(d1 - d0, 24 * H, "a normal day is 24 h");
const [s0, s1] = C.dayBounds("2026-11-01"); // US DST ends
eq(s1 - s0, 25 * H, "DST fall-back day is 25 h and still one day");

// sleep from last night, then a day
const log = [
  { id: "s", at: d0 - 1.5 * H, cat: "sleep", sub: "" },
  ev(6, 35, "meals"), ev(7, 0, "commute"), ev(7, 20, "class"), ev(9, 20, "hw", "PHYS 310"),
  ev(11, 0, "purpl"), ev(11, 0, "purpl"), ev(13, 0, "phone"), ev(13, 30, "purpl"),
];
const now = at(15, 0);
const t = C.totals(log, d0, d1, now, C.DEFAULT_CATS);
eq(t.by.sleep, 6 * H + 35 * M, "sleep clipped at midnight");
eq(t.by.purpl, 2 * H + 1.5 * H, "purpl twice, the double tap collapsed");
eq(t.subs["hw:PHYS 310"], 100 * M, "homework by course");
eq(t.work, 2 * H + 100 * M + 3.5 * H, "work = class + hw + purpl");
eq(t.tracked, 15 * H, "midnight to now, no gaps");
eq(C.current(log).cat, "purpl", "running activity is the last switch");

// backdate the latest switch 20 minutes
const last = C.current(log);
const b = C.backdate(log, last.id, last.at - 20 * M);
eq(C.current(b).at, at(13, 10), "backdated 20 min");
const b2 = C.backdate(log, last.id, at(12, 0));
eq(C.current(b2).at, at(13, 1), "backdate never swallows the block before it");

// paint 13:00 to 13:30 as gym (replaces phone) and the rest resumes
const p = C.paint(log, at(13, 0), at(13, 30), "gym", "", id, now);
const tp = C.totals(p, d0, d1, now, C.DEFAULT_CATS);
eq([tp.by.gym, tp.by.phone || 0, tp.by.purpl], [30 * M, 0, 3.5 * H], "paint replaces a block exactly");
// paint inside a long block: 14:00 to 14:15 meals inside purpl, purpl resumes
const p2 = C.paint(log, at(14, 0), at(14, 15), "meals", "", id, now);
const tp2 = C.totals(p2, d0, d1, now, C.DEFAULT_CATS);
eq([tp2.by.purpl, tp2.by.meals], [3.5 * H - 15 * M, 25 * M + 15 * M], "paint inside a block, it resumes after");
eq(C.current(p2).cat, "purpl", "still on purpl after painting the past");
// paint up to the future runs as the current activity
const p3 = C.paint(log, at(14, 30), at(18, 0), "zeng", "", id, now);
eq(C.current(p3).cat, "zeng", "a window reaching past now becomes the running block");

// remove folds into the previous block
const phoneId = C.normalize(log).find((e) => e.cat === "phone").id;
const r = C.remove(log, phoneId);
eq(C.totals(r, d0, d1, now, C.DEFAULT_CATS).by.purpl, 4 * H, "deleting phone merged purpl back together");

// recat
const rc = C.recat(log, phoneId, "social");
eq(C.totals(rc, d0, d1, now, C.DEFAULT_CATS).by.social, 30 * M, "recategorized");

// idle catch
eq(C.needsCheck(log, at(16, 29), 0), null, "under 3 h asks nothing");
eq(C.needsCheck(log, at(16, 31), 0).cat, "purpl", "over 3 h asks");
eq(C.needsCheck(log, at(16, 31), at(16, 0)), null, "a fresh 'still on it' silences it");
eq(C.needsCheck([{ id: "z", at: at(0), cat: "sleep" }], at(9), 0), null, "9 h of sleep is not a forgotten switch");

// snapshot
const snap = C.snapshot(log, "2026-11-09", { ig: 47 });
eq(snap.start.cat, "sleep", "snapshot carries what ran at midnight");
eq(snap.events.length, 7, "snapshot holds only that day's switches, collapsed");
eq(snap.ig, 47, "screen time minutes ride along");

// week
eq(C.weekStart("2026-11-09"), "2026-11-09", "Monday starts its own week");
eq(C.weekStart("2026-11-15"), "2026-11-09", "Sunday closes the week");
eq(C.addDays("2026-11-30", 1), "2026-12-01", "month rollover");

eq(C.fmtDur(95 * M), "1h 35m", "duration words");
eq(C.fmtClock(at(14, 5)), "2:05 pm", "12-hour clock");
eq(C.fmtClock(at(0, 0)), "12:00 am", "midnight");

// ---- sophon review, 2026-11-09 ----
// normalize is idempotent even when a same-instant replacement lands on the
// activity before it (A, then B and A at one instant, used to leave A, A)
const twice = [{ id: "a", at: at(1), cat: "gym" }, { id: "b", at: at(2), cat: "meals" }, { id: "c", at: at(2), cat: "gym" }];
eq(C.normalize(twice).length, 1, "same-instant replacement collapses into the block before");
eq(C.normalize(C.normalize(twice)), C.normalize(twice), "normalize is idempotent");

// a start time is never in the future, and a squeezed block does not jump its neighbour
eq(C.current(C.backdate(log, last.id, now + 5 * H, now)).at, now, "backdate is capped at now");
const tight = [{ id: "a", at: at(1), cat: "gym" }, { id: "b", at: at(1, 1), cat: "meals" }, { id: "c", at: at(1, 2), cat: "purpl" }];
eq(C.backdate(tight, "b", at(0)).map((e) => e.id), ["a", "b", "c"], "a block squeezed under 2 min stays in order");
eq(C.backdate(tight, "b", at(0))[1].at, at(1, 1), "and keeps its time");

// typed times: 11:00 pm typed at 7 am is last night; 6:30 am typed at 7 am is today
eq(C.lastAt("23:00", at(7)), d0 - 1 * H, "11:00 pm typed in the morning is last night");
eq(C.lastAt("06:30", at(7)), at(6, 30), "an earlier time today stays today");
eq(C.lastAt("07:00", at(7)), at(7), "exactly now is now");
eq(C.endAfter(d0 - 0.5 * H, "01:00"), at(1), "11:30 pm to 1:00 am ends the next day");
eq(C.endAfter(at(13), "14:00"), at(14), "a same-day end stays on the day");
const f0 = C.dayBounds("2026-11-01")[0]; // 25 h day
eq(C.endAfter(f0 - 0.5 * H, "03:00") - f0, 4 * H, "end time across the DST fall-back night is the wall clock 3:00 am");

// the forgotten Sleep tap, fixed the next morning: homework ran from 9 pm, he
// slept at 11 pm, opens the app at 7 am and types 11:00 pm
const night = [{ id: "h", at: d0 - 3 * H, cat: "hw", sub: "" }];
const fixed = night.concat([{ id: "sl", at: C.lastAt("23:00", at(7)), cat: "sleep", sub: "" }]);
eq(C.totals(fixed, d0 - 24 * H, d1, at(7), C.DEFAULT_CATS).by, { hw: 2 * H, sleep: 8 * H }, "sleep lands at last night's 11 pm, not at 7 am");

// rebuild: the Worker's day snapshots give back the same log (ids aside)
const strip = (l) => C.normalize(l).map((e) => [e.at, e.cat, e.sub || ""]);
const snaps = [C.snapshot(log, "2026-11-08", {}), C.snapshot(log, "2026-11-09", {})];
eq(strip(C.rebuild(snaps, id)), strip(log), "rebuild from two day snapshots is the original log");
eq(strip(C.rebuild([C.snapshot(log, "2026-11-09", {})], id)), strip(log), "one snapshot carries the block running at midnight");
eq(C.rebuild([], id), [], "no snapshots, empty log");

eq(C.fmtHours(11.6 * H), "11.6 h", "hours keep one decimal past ten");
eq(C.fmtHours(43.44 * H), "43.4 h", "week hours keep one decimal");
eq(C.fmtDur(-5 * M), "0m", "a duration is never negative");

console.log(fails ? `${fails} of ${n} FAILED` : `all ${n} passed`);
process.exit(fails ? 1 : 0);
