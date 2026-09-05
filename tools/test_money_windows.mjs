// Tests the money tab's window maths against David's real lots.
//
// The defect these pin (Desk d-20260831-80a7ca78): every window delta used to be
// shares_now * (price - windowOpenClose), which credits a position bought inside
// the window with a move it was not in, and "life" borrowed the 1m series so
// month and lifetime drew an identical shape. Run: node tools/test_money_windows.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "money.js"), "utf8");

// Pull the real shipped functions out of money.js rather than retyping them,
// so this test cannot pass against a copy that has drifted from the app.
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, "money.js has no function " + name);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    else if (src[j] === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error("unbalanced braces reading " + name);
}

const posShares = (pos) => pos.lots.reduce((a, l) => a + (l.shares || 0), 0);
const posBasis = (pos) => pos.lots.reduce((a, l) => a + (l.basis || 0), 0);
const ptMs = (pt) => (typeof pt.t === "number" ? pt.t : Date.parse(pt.t));
const ctx = { posShares, posBasis, ptMs };
// dependency order matters: clipToOwnership calls firstLotMs, so build that first
for (const name of ["firstLotMs", "heldDays", "basisPerShare", "windowDelta", "clipToOwnership"]) {
  ctx[name] = new Function("posShares", "posBasis", "ptMs", "firstLotMs",
    grab(name) + "; return " + name + ";")(posShares, posBasis, ptMs, ctx.firstLotMs);
}
const { windowDelta, clipToOwnership, firstLotMs, basisPerShare } = ctx;

const near = (a, b, eps = 0.011) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const ms = (d) => Date.parse(d + "T00:00:00");

// David's real positions, from Money/holdings.json asOf 2026-08-17.
const VTI = { ticker: "VTI", lots: [{ shares: 5, basis: 1904.75, fillDate: "2026-08-11" }] };
const TOST = { ticker: "TOST", lots: [
  { shares: 23, basis: 741.18, fillDate: "2026-07-28" },
  { shares: 30, basis: 1050.00, fillDate: "2026-08-11" },
]};
const RKLB = { ticker: "RKLB", lots: [] };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

console.log("window maths");

t("VTI: a lot bought INSIDE the window is measured from what he paid, not the window open", () => {
  // Bought Aug 11 at 380.95/sh. A 1m window opening Aug 3 at 370 must not
  // hand him the Aug 3 to Aug 11 move, which he was not in.
  const d = windowDelta(VTI, ms("2026-08-03"), 370, 380.65);
  near(d.amt, -1.50);
  // and the old formula, kept here to show the size of the lie it told
  near(posShares(VTI) * (380.65 - 370), 53.25);
});

t("VTI lifetime equals value minus cost exactly", () => {
  const d = windowDelta(VTI, null, null, 380.65);
  near(d.amt, 5 * 380.65 - 1904.75);
  near(d.amt, -1.50);
});

t("TOST: the held lot uses the window open, the new lot uses its own basis", () => {
  // lot1 (Jul 28) held at the Aug 3 open -> 23 * (34.88 - 34.00) = +20.24
  // lot2 (Aug 11) bought inside        -> 30 * (34.88 - 35.00) =  -3.60
  const d = windowDelta(TOST, ms("2026-08-03"), 34.00, 34.88);
  near(d.amt, 16.64);
  near(posShares(TOST) * (34.88 - 34.00), 46.64); // what it used to print
});

t("TOST lifetime still reconciles to the ledger's own number", () => {
  const d = windowDelta(TOST, null, null, 34.88);
  near(d.amt, 57.46);
  near(d.amt, posShares(TOST) * 34.88 - posBasis(TOST));
});

t("a window entirely after every fill behaves exactly like the old formula", () => {
  // nothing was bought inside it, so there is no correction to make
  const d = windowDelta(TOST, ms("2026-08-20"), 34.00, 34.88);
  near(d.amt, posShares(TOST) * (34.88 - 34.00));
});

t("percent is against the money actually at risk in the window, never zero-divide", () => {
  const d = windowDelta(VTI, null, null, 380.65);
  near(d.pct, -1.50 / 1904.75);
  const empty = windowDelta(RKLB, null, null, 40);
  assert.equal(empty.amt, null);
  assert.equal(empty.pct, null);
});

console.log("clipping");

const series = [
  { t: ms("2026-07-01"), c: 300 }, { t: ms("2026-08-01"), c: 350 },
  { t: ms("2026-08-12"), c: 375 }, { t: ms("2026-08-20"), c: 380 },
];

t("points from before the first fill are dropped", () => {
  const r = clipToOwnership(series, VTI); // VTI filled 2026-08-11
  assert.equal(r.pts.length, 2);
  assert.equal(r.clipped, true);
  assert.ok(r.pts.every((pt) => ptMs(pt) >= firstLotMs(VTI)));
});

t("a position held through the whole series is not clipped", () => {
  const r = clipToOwnership(series, { lots: [{ shares: 1, basis: 1, fillDate: "2026-06-01" }] });
  assert.equal(r.pts.length, series.length);
  assert.equal(r.clipped, false);
});

t("a position bought yesterday still draws a line instead of vanishing", () => {
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const r = clipToOwnership(series, { lots: [{ shares: 1, basis: 1, fillDate: y }] });
  assert.ok(r.pts.length >= 2, "must keep at least two points");
});

t("no fill dates at all degrades to the full series rather than throwing", () => {
  const r = clipToOwnership(series, { lots: [{ shares: 1, basis: 1 }] });
  assert.equal(r.pts.length, series.length);
  assert.equal(firstLotMs({ lots: [{ shares: 1, basis: 1 }] }), null);
});

console.log("wiring");

t("life draws the max series, not the month series", () => {
  const m = src.match(/const range = sel === "week" \? "1w" : sel === "day" \? "1d" :[^;]*;/);
  assert.ok(m, "range selector line not found");
  assert.ok(/sel === "life" \? "max"/.test(m[0]),
    'life must map to "max"; borrowing "1m" is what made month and lifetime identical');
});

t("basis per share is what the dotted reference line is drawn at", () => {
  near(basisPerShare(VTI), 380.95);
  near(basisPerShare(TOST), 1791.18 / 53);
  assert.equal(basisPerShare(RKLB), null);
});

t("every selector value has a caption", () => {
  for (const k of ["day:", "week:", "month:", "life:"]) {
    assert.ok(src.includes("    " + k + " \""), "CAPTION is missing " + k);
  }
});

console.log(`\n${n} tests passed`);
