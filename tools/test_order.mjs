// Self-check for order.js, the Today screen's priority order and anchors.
// Run: node tools/test_order.mjs
import assert from "node:assert/strict";
import { nextList, anchorsFor, todaysNews, frontAge, sectionLabel, clock, inWords, CAP } from "../order.js";

const T = "2026-10-13"; // a Tuesday
const row = (id, days, extra = {}) => ({ id, text: id, ...(days === null ? {} : { due: "2026-10-" + (13 + days), days }), ...extra });

const front = {
  board: [
    { title: "🚨 RECRUITER: reply today", rows: [row("tk-rec", null)] },
    { title: "🔥 NOW: this week", rows: [row("tk-o1", -1), row("tk-today", 0), row("tk-fri", 3), row("tk-undated", null), row("tk-o2", -2)] },
    { title: "🎯 ON A TRIGGER (no date)", rows: [row("tk-trigger", null)] },
  ],
  due: [row("tk-o1", -1), row("due-doctor", 0)],
};
const actions = [{ id: "paper", label: "Paper, 30 min" }];

let { rows, more } = nextList(front, actions, T);
assert.deepEqual(rows.map((r) => r.kind === "row" ? r.row.id : r.item.id),
  ["tk-o2", "tk-o1", "tk-rec", "tk-today", "due-doctor", "paper", "tk-fri"]);
assert.equal(more, 1, "tk-undated is the eighth");
assert.equal(rows[0].reason, "2 days over");
assert.equal(rows[2].reason, "recruiter");
assert.equal(rows[6].reason, "due Fri");
assert.ok(!rows.some((r) => r.row && r.row.id === "tk-trigger"), "a trigger row is never next");
assert.equal(new Set(rows.map((r) => r.row ? r.row.id : r.item.id)).size, rows.length, "deduped by id");

// more than three overdue fold into one row, which keeps them all
const many = { board: [{ title: "NOW", rows: [row("a", -1), row("b", -2), row("c", -3), row("d", -4), row("e", 0)] }] };
({ rows } = nextList(many, [], T));
assert.equal(rows[0].kind, "overdue");
assert.equal(rows[0].reason, "4 overdue");
assert.deepEqual(rows[0].rows.map((r) => r.row.id), ["d", "c", "b", "a"]);
assert.equal(rows[1].row.id, "e");
assert.ok(rows.length <= CAP);

// anchors: only today's, plus lights out on a school night, next and current
const fa = { anchors: [
  { t: "2026-10-12T09:30-04:00", end: "2026-10-12T10:20-04:00", title: "yesterday", cal: "Classes" },
  { t: "2026-10-13T09:30-04:00", end: "2026-10-13T10:20-04:00", title: "ME 264", cal: "Classes" },
  { t: "2026-10-13T13:30-04:00", end: "2026-10-13T14:20-04:00", title: "ME 290", cal: "Classes" },
] };
const at10 = new Date("2026-10-13T10:00:00-04:00");
let a = anchorsFor(fa, T, at10);
assert.deepEqual(a.list.map((x) => x.title), ["ME 264", "ME 290", "Lights out"]);
assert.equal(a.current.title, "ME 264");
assert.equal(a.next.title, "ME 290");
a = anchorsFor(fa, "2026-10-16", at10); // a Friday: no lights-out rule, no anchors
assert.equal(a.list.length, 0);
assert.equal(clock(new Date(2026, 9, 13, 23, 30)), "11:30 pm");
assert.equal(clock(new Date(2026, 9, 13, 0, 5)), "12:05 am");
assert.equal(inWords(47 * 60000), "in 47 min");
assert.equal(inWords(125 * 60000), "in 2 h 5 min");

assert.equal(todaysNews([{ id: "news-2026-10-13", kind: "news", date: T }, { id: "news-2026-10-13-duet", kind: "news", date: T },
  { id: "x", kind: "daily", date: T }], T).id, "news-2026-10-13-duet");
assert.equal(todaysNews([{ id: "news-2026-10-12-duet", kind: "news", date: "2026-10-12" }], T), null);
assert.equal(frontAge({}, at10), null);
assert.equal(frontAge({ asof: "2026-10-13T09:00-04:00" }, at10), 3600000);
assert.equal(sectionLabel("🔥 NOW: this week, Mon 10/12"), "now");
assert.equal(sectionLabel("✎ ON THE DESK: notes"), "on the desk");

console.log("order.js: next list, anchors, news and staleness checked, all assertions passed");
