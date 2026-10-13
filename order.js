// order.js: the Today screen's "Next up" list and its fixed anchors. Pure, no
// DOM, so tools/test_order.mjs can run it in node.
//
// David, 2026-10-07: "i dont live by slots... i live by priority order of what
// needs to get done and i get it done then move to next. only time blocks are
// classes." 2026-10-13: "Priority list, not slots, I agree." So Today shows ONE
// ordered list and only real anchors carry a clock (the five slot bands it
// replaced ran 2026-08 to 2026-10-13).
//
// The order (tribunal Plan Gate, 2026-10-13):
//   0 overdue, most overdue first (more than three fold into one row placed
//     after the recruiter and due-today rows)
//   1 recruiter rows (L38: a recruiter email sat unseen three weeks; above coursework)
//   2 due today
//   3 today's action cards (paper, interview rep, outreach block)
//   4 dated rows due within a week, soonest first
//   5 undated rows from the live sections (recruiter, desk, swept in, NOW), in
//     note order, labelled "no date" so an unparsed date is said, not hidden
//   6 dated rows a week or more out
// Each row says why it is where it is, in two or three words, because a
// computed order is only trusted when it shows its reason.

export const CAP = 7;          // one screen; the rest is "N more" (the board below has all of it)
export const OVERDUE_FOLD = 3; // more than this many overdue collapse into one row
export const SOON_DAYS = 7;    // a dated row this far out or more ranks below undated NOW rows

// undated rows only count from the sections that hold this week's work; a row
// "on a trigger" or "after Sunday" is not next just because it has no date
const LIVE = /RECRUITER|DESK|SWEPT|NOW/i;
const RECRUITER = /RECRUITER/i;

export function sectionLabel(title) {
  const t = String(title || "").replace(/^[^A-Za-z]+/, "").split(/[:(]/)[0].trim().toLowerCase();
  return t.length > 18 ? t.slice(0, 17) + "…" : t;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dueReason(r, today) {
  const n = Number(r.days || 0);
  if (n < 0) return Math.abs(n) + (n === -1 ? " day over" : " days over");
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n < 7 && r.due) return "due " + WD[new Date(r.due + "T12:00:00").getDay()];
  return "in " + n + " days";
}

// front: the brief's front block. actions: today's action leaves from the
// timeline (already filtered by the caller). Returns
// { rows: [{kind, rank, reason, row|item|rows}], more }.
export function nextList(front, actions, today) {
  const f = front || {};
  const seen = new Map();
  let order = 0;
  const add = (r, section, secIdx) => {
    if (!r || !r.id || seen.has(r.id)) return;
    seen.set(r.id, { r, section, secIdx, order: order++ });
  };
  // the board first, so a row on both lists keeps its board section (recruiter)
  (f.board || []).forEach((s, i) => (s.rows || []).forEach((r) => add(r, s.title, i)));
  (f.due || []).forEach((r) => add(r, "Due", 999)); // read-only doctor rows after the tickable ones

  const out = [];
  const t0 = Date.parse(today + "T12:00:00");
  for (const { r: raw, section, secIdx, order: o } of seen.values()) {
    // `days` is recomputed against the PHONE's today: the laptop's figure is
    // frozen at build time, so on a brief from yesterday "due today" would
    // still say due today when it is a day over (tribunal Realist)
    const dd = raw.due ? Math.round((Date.parse(raw.due + "T12:00:00") - t0) / 86400000) : NaN;
    const r = isNaN(dd) ? raw : { ...raw, days: dd };
    const dated = !!r.due && typeof r.days === "number";
    let rank, reason;
    if (dated && r.days < 0) { rank = 0; reason = dueReason(r, today); }
    else if (RECRUITER.test(section)) { rank = 1; reason = dated ? "recruiter, " + dueReason(r, today) : "recruiter"; }
    else if (dated && r.days === 0) { rank = 2; reason = "due today"; }
    // dated rows a week or more out sit BELOW this week's undated work: a
    // row due in 83 days is not next (tribunal Engineer)
    else if (dated) { rank = r.days < SOON_DAYS ? 4 : 6; reason = dueReason(r, today); }
    else if (LIVE.test(section)) { rank = 5; reason = sectionLabel(section) + ", no date"; }
    else continue;
    out.push({ kind: "row", rank, reason, row: r, section, key: [rank, dated ? r.days : 0, secIdx, o] });
  }
  (actions || []).forEach((it, i) => out.push({ kind: "action", rank: 3, reason: "today", item: it, key: [3, 0, 0, i] }));
  out.sort((a, b) => {
    for (let k = 0; k < 4; k++) if (a.key[k] !== b.key[k]) return a.key[k] - b.key[k];
    return 0;
  });

  // A pile of overdue rows is folded into one row, and the fold sits AFTER
  // the recruiter and due-today rows: ten stale rows in slot one hid the real
  // top item (tribunal Usability, 2026-10-13). Three or fewer stay on top.
  const over = out.filter((x) => x.rank === 0);
  let rows = out;
  if (over.length > OVERDUE_FOLD) {
    const fold = { kind: "overdue", rank: 0, reason: over.length + " overdue", rows: over };
    const rest = out.filter((x) => x.rank !== 0);
    // ...but never past the cap: with 26 rows due today the fold fell off the
    // screen and the overdue pile vanished (tribunal Realist, loop 1)
    const found = rest.findIndex((x) => x.rank > 2);
    const at = Math.min(found === -1 ? rest.length : found, CAP - 1);
    rows = [...rest.slice(0, at), fold, ...rest.slice(at)];
  }
  return { rows: rows.slice(0, CAP), more: Math.max(0, rows.length - CAP) };
}

// ---- fixed anchors ----
// The calendar's classes, meetings and exams (front.anchors, laptop-built and
// refreshed hourly) plus lights out, which is a rule, not an event: 11:30 pm
// Sunday to Thursday (ruled 10/12). Only the anchors of `today` are kept, so a
// stale brief never shows yesterday's classes as today's.
export const LIGHTS_OUT = { h: 23, m: 30, days: [0, 1, 2, 3, 4] };

export function anchorsFor(front, todayIso, now) {
  const list = ((front && front.anchors) || [])
    .filter((a) => a && typeof a.t === "string" && a.t.slice(0, 10) === todayIso)
    .map((a) => ({ at: new Date(a.t), end: a.end ? new Date(a.end) : null, title: String(a.title || ""), cal: String(a.cal || "") }))
    .filter((a) => !isNaN(a.at));
  const day = new Date(todayIso + "T12:00:00");
  if (LIGHTS_OUT.days.includes(day.getDay())) {
    const lo = new Date(todayIso + "T00:00:00");
    lo.setHours(LIGHTS_OUT.h, LIGHTS_OUT.m, 0, 0);
    list.push({ at: lo, end: null, title: "Lights out", cal: "rule" });
  }
  list.sort((a, b) => a.at - b.at);
  const t = (now || new Date()).getTime();
  // "next" is the first anchor not yet started; one in progress is "now"
  const current = list.find((a) => a.end && a.at.getTime() <= t && a.end.getTime() > t) || null;
  const next = list.find((a) => a.at.getTime() > t) || null;
  // no anchors key at all (an older laptop build, or the calendar failed) or
  // none for today (a brief from yesterday) is NOT "nothing fixed today": the
  // calendar simply has not reached the phone (tribunal Realist)
  const loaded = !!front && Array.isArray(front.anchors) && !!front.asof && String(front.asof).slice(0, 10) === todayIso;
  return { list, current, next, loaded };
}

export function clock(d) {
  const h = d.getHours(), m = d.getMinutes();
  return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "am" : "pm");
}

export function inWords(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return "in " + min + " min";
  const h = Math.floor(min / 60), r = min % 60;
  return "in " + h + " h" + (r ? " " + r + " min" : "");
}

// The front is rebuilt every hour by the laptop sweep. Older than two hours
// means the laptop has not swept (lid shut), and the list says so.
export const STALE_MS = 2 * 3600 * 1000;
export function frontAge(front, now) {
  const a = front && front.asof ? Date.parse(front.asof) : NaN;
  if (isNaN(a)) return null;
  return (now || new Date()).getTime() - a;
}

// The day's news episode in Listen: kind "news" dated today, the two-voice
// "-duet" edition preferred.
export function todaysNews(items, todayIso) {
  const all = (items || []).filter((m) => m && m.kind === "news" && m.date === todayIso);
  return all.find((m) => /-duet$/.test(m.id || "")) || all[0] || null;
}
