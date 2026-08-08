// money.js: MONEY, "the ledger".
//
// Banking, not a dashboard. One big number, gauge dials per position, then
// ruled tables: the accounts as of a stamp, then "Get the money", the funding
// waterfall that says which committed buy is next and what raises the cash.
// Positions, dials, charts and the LTCG maths are the proven v3 code.

import {
  root, api, el, md, lsGet, lsSet, go, fmtMoney, fmtPct, arrowOf, dirClass, daysUntil,
  mastHead, appFooter, emptyState, isTab,
} from "./core.js";
import { cachedEdition } from "./news.js";

let holdings = null;
let quotes = {};
const quotesMeta = { stale: false };

export function open(parts) {
  if (parts && parts[1]) { loadDetail(parts[1].toUpperCase()); return; }
  load(false);
}

const positionTickers = () => (holdings && holdings.positions || []).map((p) => p.ticker);

function load(force) {
  holdings = lsGet("crystal.holdings", null);
  quotes = (lsGet("crystal.quotes", null) || {}).quotes || {};
  if (holdings && !force) renderMoney("");
  api("/holdings")
    .then((data) => { holdings = data; lsSet("crystal.holdings", data); renderMoney(""); refreshQuotes(); })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { holdings = null; renderMoney("", true); return; }
      if (holdings) renderMoney("Offline. Showing cached holdings.");
      else renderMoney("", true);
    });
}

function refreshQuotes() {
  const syms = positionTickers();
  if (!syms.length) return;
  api("/quotes?symbols=" + syms.join(","))
    .then((data) => {
      quotes = data.quotes || {};
      quotesMeta.stale = Object.keys(quotes).some((s) => quotes[s] && quotes[s].stale);
      lsSet("crystal.quotes", { at: data.at, quotes });
      const h = location.hash.replace(/^#\/?/, "").split("/");
      if (h[0] !== "money") return;
      if (h[1]) renderDetail(h[1].toUpperCase()); else renderMoney("");
    })
    .catch(() => {});
}

// reference close for week/month deltas, client-cached
function refPrice(sym, range, cb) {
  const k = "crystal.qh." + sym + "." + range;
  const cached = lsGet(k, null);
  const ttl = range === "1d" ? 15 * 60000 : 6 * 3600000;
  if (cached && Date.now() - cached.at < ttl) { cb(cached.data); return; }
  api("/quotehistory?symbol=" + sym + "&range=" + range)
    .then((data) => {
      if (data.points && data.points.length) lsSet(k, { at: Date.now(), data });
      cb(data);
    })
    .catch(() => cb(cached ? cached.data : null));
}

const posShares = (pos) => pos.lots.reduce((a, l) => a + (l.shares || 0), 0);
const posBasis = (pos) => pos.lots.reduce((a, l) => a + (l.basis || 0), 0);
function posValue(pos) {
  const q = quotes[pos.ticker];
  return q && typeof q.price === "number" ? posShares(pos) * q.price : null;
}

function deltaHtml(amt, pct, cls) {
  const c = dirClass(pct != null ? pct : amt);
  return '<span class="delta ' + c + (cls ? " " + cls : "") + '">' + arrowOf(pct != null ? pct : amt) +
    (amt != null ? " " + (amt >= 0 ? "+" : "−") + fmtMoney(Math.abs(amt)).slice(1) : "") +
    (pct != null ? " (" + fmtPct(pct) + ")" : "") + "</span>";
}

const SEL_LABEL = { day: "day", week: "week", month: "month", life: "lifetime" };

function gaugeSvg(pct, scale) {
  const R = 27, C = 2 * Math.PI * R;
  const ok = typeof pct === "number" && isFinite(pct);
  const frac = ok ? Math.min(Math.abs(pct) / scale, 1) : 0;
  const cls = ok ? dirClass(pct) : "";
  const color = cls === "up" ? "var(--up)" : cls === "down" ? "var(--down)" : "var(--faint)";
  const label = ok ? arrowOf(pct) + " " + fmtPct(pct) : "--";
  return '<svg width="78" height="78" viewBox="0 0 78 78" role="img" aria-label="' + label + '">' +
    '<circle cx="39" cy="39" r="' + R + '" fill="none" stroke="var(--hairline)" stroke-width="6"/>' +
    (frac > 0 ? '<circle cx="39" cy="39" r="' + R + '" fill="none" stroke="' + color +
      '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' +
      (frac * C).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 39 39)"/>' : "") +
    '<text x="39" y="43" text-anchor="middle" font-family="ui-monospace,SF Mono,Menlo,monospace"' +
    ' font-size="11.5" font-weight="600" fill="' + color + '">' + label + "</text></svg>";
}

function ltcgBadge(pos) {
  let worst = null;
  pos.lots.forEach((l) => {
    if (!l.ltcgDate) return;
    const d = daysUntil(l.ltcgDate);
    if (worst === null || d > worst) worst = d;
  });
  if (worst === null) return "";
  if (worst <= 0) return '<span class="badge up">✓ LTCG</span>';
  return '<span class="badge">sellable in ' + worst + "d</span>";
}

function renderMoney(note, noHoldings) {
  if (!isTab("money")) return;
  root.innerHTML = "";
  const sub = holdings ? "as of " + String(holdings.asOf).slice(0, 10) : "";
  root.appendChild(mastHead("money", "The Ledger", sub));

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (noHoldings || !holdings) {
    root.appendChild(emptyState("💰", "No holdings yet",
      "The portfolio pipeline has not pushed. Once it does, the dials appear here."));
    root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
    root.appendChild(appFooter(() => load(true)));
    return;
  }

  const sel = lsGet("crystal.moneySel", "day");
  const positions = holdings.positions || [];
  const cash = holdings.cash || [];
  const cashTotal = cash.reduce((a, c) => a + c.amount, 0);

  // ---- portfolio header ----
  let totalVal = cashTotal, totalCost = cashTotal, dayAmt = 0, havePrices = true, havePrev = true;
  positions.forEach((p) => {
    const v = posValue(p);
    totalCost += posBasis(p);
    if (v === null) { havePrices = false; return; }
    totalVal += v;
    const q = quotes[p.ticker];
    if (q && typeof q.prevClose === "number") dayAmt += posShares(p) * (q.price - q.prevClose);
    else havePrev = false;
  });
  const pf = el("section", { class: "pf" });
  pf.appendChild(el("div", { class: "eyebrow" }, "portfolio" + (quotesMeta.stale ? " · quotes stale" : "")));
  pf.appendChild(el("div", { class: "total" }, havePrices ? fmtMoney(totalVal) : "--"));
  const lifeAmt = havePrices ? totalVal - totalCost : null;
  const subrow = el("div", { class: "subrow" });
  subrow.appendChild(el("span", {}, "cost " + fmtMoney(totalCost)));
  if (havePrices && havePrev) {
    const dayBase = totalVal - dayAmt;
    subrow.appendChild(el("span", {}, "day " + deltaHtml(dayAmt, dayBase ? dayAmt / dayBase : null)));
  }
  if (lifeAmt !== null) {
    subrow.appendChild(el("span", {}, "life " + deltaHtml(lifeAmt, totalCost ? lifeAmt / totalCost : null)));
  }
  pf.appendChild(subrow);
  root.appendChild(pf);

  // ---- accounts: David-entered numbers, always stamped ----
  if (holdings.accounts) root.appendChild(accountsStrip(holdings.accounts));

  // ---- delta selector ----
  const seg = el("div", { class: "seg", role: "tablist", "aria-label": "Delta window" });
  ["day", "week", "month", "life"].forEach((s) => {
    const b = el("button", { type: "button", "aria-current": s === sel ? "true" : "false" }, SEL_LABEL[s]);
    b.addEventListener("click", () => { lsSet("crystal.moneySel", s); renderMoney(""); });
    seg.appendChild(b);
  });
  root.appendChild(seg);

  // ---- dials ----
  const grid = el("div", { class: "dialgrid" });
  const scale = (sel === "day" || sel === "week") ? 0.10 : 0.25;
  positions.forEach((p) => {
    const q = quotes[p.ticker];
    const val = posValue(p);
    const basis = posBasis(p);
    const dial = el("div", { class: "dial", role: "button", tabindex: "0", "data-ticker": p.ticker });
    const gauge = el("div", {}, gaugeSvg(null, scale));
    dial.appendChild(gauge);
    dial.appendChild(el("div", { class: "tk2" }, p.ticker + (q && q.stale ? " · stale" : "")));
    dial.appendChild(el("div", { class: "val" }, val !== null ? fmtMoney(val) : "--"));
    dial.appendChild(el("div", { class: "sub" }, "in " + fmtMoney(basis, false)));
    const dline = el("div", { class: "d" }, "");
    dial.appendChild(dline);
    dial.appendChild(el("div", { class: "ltcg" }, ltcgBadge(p)));
    const openDetail = () => go("#/money/" + p.ticker);
    dial.addEventListener("click", openDetail);
    dial.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(); });
    grid.appendChild(dial);

    const apply = (pct, amt) => {
      gauge.innerHTML = gaugeSvg(pct, scale);
      dline.innerHTML = amt !== null ? deltaHtml(amt, pct) : '<span class="delta">--</span>';
    };
    if (val === null) { apply(null, null); return; }
    if (sel === "life") {
      apply(basis ? (val - basis) / basis : null, val - basis);
    } else if (sel === "day") {
      if (q && typeof q.prevClose === "number" && q.prevClose) {
        apply((q.price - q.prevClose) / q.prevClose, posShares(p) * (q.price - q.prevClose));
      } else apply(null, null);
    } else {
      refPrice(p.ticker, sel === "week" ? "1w" : "1m", (h) => {
        if (h && h.points && h.points.length) {
          const ref = h.points[0].c;
          apply(ref ? (q.price - ref) / ref : null, posShares(p) * (q.price - ref));
        } else apply(null, null);
      });
    }
  });
  root.appendChild(grid);
  root.appendChild(el("div", { class: "gaugehint" },
    "ring full at ±" + Math.round(scale * 100) + "% · " + SEL_LABEL[sel] + " change"));

  // ---- get the money ----
  const gm = getTheMoney(holdings);
  if (gm) root.appendChild(gm);

  // ---- cash earmarks ----
  if (cash.length) {
    const sec = el("div", { class: "cashsec" });
    sec.appendChild(el("div", { class: "eyebrow" }, "cash · earmarked"));
    cash.forEach((c) => {
      const row = el("div", { class: "cashrow" });
      row.appendChild(el("b", {}, md(c.name)));
      row.appendChild(el("span", { class: "amt" }, fmtMoney(c.amount, false)));
      if (c.earmark) row.appendChild(el("span", { class: "em" }, md(c.earmark)));
      sec.appendChild(row);
    });
    root.appendChild(sec);
  }

  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(() => { load(true); refreshQuotes(); }));
}

// accounts: {checking, creditCard, income, asOf}
function accountsStrip(a) {
  const box = el("section", { class: "ledger" });
  const h = el("div", { class: "lh" });
  h.appendChild(el("span", {}, "accounts"));
  if (a.asOf) h.appendChild(el("span", { class: "asof" }, "as of " + md(String(a.asOf).slice(0, 10))));
  box.appendChild(h);
  [["Checking", a.checking], ["Credit card", a.creditCard], ["Income this month", a.income]].forEach((r) => {
    if (typeof r[1] !== "number") return;
    const row = el("div", { class: "lr" });
    row.appendChild(el("span", { class: "n" }, r[0]));
    row.appendChild(el("span", { class: "v" }, fmtMoney(r[1])));
    box.appendChild(row);
  });
  return box;
}

// "Get the money": which committed buy is next, what is short, and the
// concrete actions that raise it. This is where the old Today money-move card
// lives now.
function getTheMoney(h) {
  const commits = Array.isArray(h.commitments) ? h.commitments : [];
  const funding = Array.isArray(h.funding) ? h.funding : [];
  if (!commits.length && !funding.length) return null;
  const box = el("section", { class: "ledger" });
  const head = el("div", { class: "lh" });
  head.appendChild(el("span", {}, "get the money"));
  box.appendChild(head);

  commits.forEach((c) => {
    const row = el("div", { class: "lr" });
    row.appendChild(el("span", { class: "n" }, md(c.label)));
    if (c.due) row.appendChild(el("span", { class: "due" }, "due " + md(c.due)));
    row.appendChild(el("span", { class: "v" }, fmtMoney(c.amount, false)));
    if (c.fundedBy) row.appendChild(el("span", { class: "by" }, "funded by " + md(c.fundedBy)));
    box.appendChild(row);
  });

  funding.forEach((f) => {
    const row = el("div", { class: "lr" });
    row.appendChild(el("span", { class: "n" }, md(f.source)));
    if (typeof f.est === "number") row.appendChild(el("span", { class: "v" }, fmtMoney(f.est, false)));
    else if (f.est) row.appendChild(el("span", { class: "v" }, md(String(f.est))));
    if (f.action) row.appendChild(el("span", { class: "by" }, md(f.action)));
    box.appendChild(row);
  });
  return box;
}

// ---------- detail ----------
function loadDetail(ticker) {
  holdings = holdings || lsGet("crystal.holdings", null);
  quotes = Object.keys(quotes).length ? quotes : ((lsGet("crystal.quotes", null) || {}).quotes || {});
  if (!holdings) {
    api("/holdings").then((data) => {
      holdings = data; lsSet("crystal.holdings", data); renderDetail(ticker); refreshQuotes();
    }).catch(() => go("#/money"));
    return;
  }
  renderDetail(ticker);
  if (!quotes[ticker]) refreshQuotes();
}

function renderDetail(ticker) {
  const pos = (holdings && holdings.positions || []).find((p) => p.ticker === ticker);
  if (!pos) { go("#/money"); return; }
  if (!isTab("money")) return;
  root.innerHTML = "";

  const back = el("button", { type: "button", class: "backbtn" }, "← the ledger");
  back.addEventListener("click", () => go("#/money"));
  root.appendChild(back);

  const det = el("div", { class: "det" });
  const q = quotes[ticker];
  const headRow = el("div", { class: "tkhead" });
  headRow.appendChild(el("h2", {}, ticker));
  if (q && q.stale) headRow.appendChild(el("span", { class: "badge gold" }, "stale quote"));
  if (q && q.source === "stooq-delayed") headRow.appendChild(el("span", { class: "badge" }, "delayed"));
  headRow.appendChild(el("span", { class: "px" }, q && typeof q.price === "number" ? fmtMoney(q.price) : "--"));
  det.appendChild(headRow);
  if (q && typeof q.prevClose === "number" && q.prevClose) {
    const dp = (q.price - q.prevClose) / q.prevClose;
    det.appendChild(el("div", { style: "font-family:var(--mono);font-size:.78rem" },
      "today " + deltaHtml(posShares(pos) * (q.price - q.prevClose), dp)));
  }

  det.appendChild(el("h4", {}, "Price"));
  const range = lsGet("crystal.chartRange", "1m");
  const seg = el("div", { class: "seg", role: "tablist", "aria-label": "Chart range" });
  [["1d", "1D"], ["1w", "1W"], ["1m", "1M"], ["max", "MAX"]].forEach((r) => {
    const b = el("button", { type: "button", "aria-current": r[0] === range ? "true" : "false" }, r[1]);
    b.addEventListener("click", () => { lsSet("crystal.chartRange", r[0]); renderDetail(ticker); });
    seg.appendChild(b);
  });
  det.appendChild(seg);
  const chartCard = el("div", { class: "chartcard" }, '<p class="empty" style="margin:30px 0">loading…</p>');
  det.appendChild(chartCard);
  // the callback can fire synchronously from the client cache, before the card
  // is in the document, so hold the element itself and never getElementById
  refPrice(ticker, range, (h) => {
    if (!h || !h.points || !h.points.length) {
      chartCard.innerHTML = '<p class="empty" style="margin:26px 0">' +
        (h && h.error ? "Chart unavailable: " + md(h.error) : "No chart data for this range.") + "</p>";
      return;
    }
    drawChart(chartCard, h, range);
  });

  det.appendChild(el("h4", {}, "Lots"));
  const wrapT = el("div", { class: "tablewrap" });
  const tbl = el("table", { class: "lots" });
  tbl.appendChild(el("thead", {}, "<tr><th>filled</th><th>shares</th><th>basis</th><th>ltcg</th><th>status</th></tr>"));
  const tb = el("tbody", {});
  pos.lots.forEach((l) => {
    const d = l.ltcgDate ? daysUntil(l.ltcgDate) : null;
    const ltcg = d === null ? '<span class="badge">unknown</span>'
      : d <= 0 ? '<span class="badge up">✓ LTCG</span>' : '<span class="badge">in ' + d + "d</span>";
    const ver = l.verified ? '<span class="badge up">✓ verified</span>'
      : '<span class="badge gold">UNVERIFIED</span>';
    tb.appendChild(el("tr", {},
      "<td>" + md(l.fillDate || "--") + "</td><td>" + (l.shares == null ? "--" : Number(l.shares)) +
      "</td><td>" + (l.basis == null ? "--" : fmtMoney(l.basis, false)) +
      "</td><td>" + ltcg + "</td><td>" + ver + "</td>"));
  });
  tbl.appendChild(tb);
  wrapT.appendChild(tbl);
  det.appendChild(wrapT);

  if (pos.breakers && pos.breakers.length) {
    det.appendChild(el("h4", {}, "Thesis breakers"));
    pos.breakers.forEach((b) => {
      const card = el("div", { class: "breaker" });
      card.appendChild(el("div", {}, md(b.text)));
      card.appendChild(el("div", { class: "status" }, "status: " + md(b.status)));
      det.appendChild(card);
    });
  }

  if (pos.nextEvent && pos.nextEvent.date) {
    det.appendChild(el("h4", {}, "Next event"));
    const ev = el("div", { class: "eventcard" });
    const dd = daysUntil(pos.nextEvent.date);
    ev.appendChild(el("div", { class: "ed" },
      md(pos.nextEvent.date) + (dd >= 0 ? " · in " + dd + "d" : "") + " · " + md(pos.nextEvent.label)));
    if (pos.nextEvent.gate) ev.appendChild(el("div", { class: "gate" }, md(pos.nextEvent.gate)));
    det.appendChild(ev);
  }

  if (pos.rules && pos.rules.length) {
    det.appendChild(el("h4", {}, "Bound council rules"));
    const rl = el("ul", { class: "rulelist" });
    pos.rules.forEach((r) => rl.appendChild(el("li", {}, md(r))));
    det.appendChild(rl);
  }

  const edition = cachedEdition();
  const related = ((edition && edition.stories) || []).filter((s) => (s.tickerTags || []).indexOf(ticker) >= 0);
  if (related.length) {
    det.appendChild(el("h4", {}, "In the news"));
    related.forEach((s) => {
      const item = el("div", { class: "newsitem", role: "button", tabindex: "0" });
      item.appendChild(el("div", { class: "cat" }, md(s.cat)));
      item.appendChild(el("div", {}, md(s.headline)));
      item.addEventListener("click", () => go("#/news/" + encodeURIComponent(s.id)));
      det.appendChild(item);
    });
  }

  root.appendChild(det);
  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(() => { refreshQuotes(); renderDetail(ticker); }));
}

// line chart with a touch crosshair; colour follows the range direction, with
// the signed change printed, never colour alone
function drawChart(container, hist, range) {
  const pts = hist.points;
  const W = 340, H = 150, padL = 6, padR = 6, padT = 12, padB = 18;
  let min = Infinity, max = -Infinity;
  pts.forEach((p) => { if (p.c < min) min = p.c; if (p.c > max) max = p.c; });
  if (min === max) { min -= 1; max += 1; }
  const X = (i) => padL + (i / (pts.length - 1 || 1)) * (W - padL - padR);
  const Y = (c) => padT + (1 - (c - min) / (max - min)) * (H - padT - padB);
  const up = pts[pts.length - 1].c >= pts[0].c;
  const color = up ? "var(--up)" : "var(--down)";
  const path = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.c).toFixed(1)).join("");
  const area = path + "L" + X(pts.length - 1).toFixed(1) + " " + (H - padB) + "L" + padL + " " + (H - padB) + "Z";
  const chg = pts[pts.length - 1].c - pts[0].c;
  const chgPct = pts[0].c ? chg / pts[0].c : 0;

  container.innerHTML =
    '<svg viewBox="0 0 ' + W + " " + H + '" id="pxchart" role="img" aria-label="price chart">' +
    '<path d="' + area + '" fill="' + color + '" opacity="0.08"/>' +
    '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
    '<line id="ch-x" x1="0" y1="' + padT + '" x2="0" y2="' + (H - padB) +
    '" stroke="var(--faint)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>' +
    '<circle id="ch-dot" r="3.5" fill="' + color + '" stroke="var(--card)" stroke-width="1.5" visibility="hidden"/>' +
    '<text id="ch-tip" x="0" y="9" font-family="ui-monospace,Menlo,monospace" font-size="9.5"' +
    ' fill="var(--dim)" visibility="hidden"></text></svg>' +
    '<div class="chartnote"><span>' + fmtRangeDate(pts[0].t, range) + " · " + fmtMoney(pts[0].c) +
    "</span><span>" + arrowOf(chg) + " " + fmtPct(chgPct) +
    (hist.stale ? " · cached, provider offline" : "") +
    (hist.source === "stooq-delayed" ? " · delayed" : "") +
    "</span><span>" + fmtRangeDate(pts[pts.length - 1].t, range) + " · " +
    fmtMoney(pts[pts.length - 1].c) + "</span></div>" +
    '<div class="chartnote"><span>low ' + fmtMoney(min) + "</span><span>high " + fmtMoney(max) + "</span></div>";

  const svg = container.querySelector("#pxchart");
  const chx = container.querySelector("#ch-x");
  const dot = container.querySelector("#ch-dot");
  const tip = container.querySelector("#ch-tip");
  function scrub(clientX) {
    const r = svg.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width * W;
    let i = Math.round((fx - padL) / ((W - padL - padR) / (pts.length - 1 || 1)));
    i = Math.max(0, Math.min(pts.length - 1, i));
    const x = X(i), y = Y(pts[i].c);
    chx.setAttribute("x1", x); chx.setAttribute("x2", x);
    chx.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y);
    dot.setAttribute("visibility", "visible");
    tip.textContent = fmtRangeDate(pts[i].t, range) + "  " + fmtMoney(pts[i].c);
    tip.setAttribute("text-anchor", x > W * 0.66 ? "end" : x < W * 0.33 ? "start" : "middle");
    tip.setAttribute("x", x);
    tip.setAttribute("visibility", "visible");
  }
  svg.addEventListener("pointerdown", (e) => scrub(e.clientX));
  svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") scrub(e.clientX); });
  svg.addEventListener("pointerleave", () => {
    chx.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.setAttribute("visibility", "hidden");
  });
}

function fmtRangeDate(t, range) {
  const d = new Date(t);
  if (range === "1d") {
    const h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "p" : "a";
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + ap;
  }
  if (range === "max") return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
