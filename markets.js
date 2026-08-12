// markets.js: MARKETS, "the terminal".
//
// Not a page of prose. A dark instrument panel that keeps its own surface in
// both themes: mono type, a grid of ticker chips with a status dot, and one
// accordion body under the grid. Everything that is not a ticker (Tomorrow,
// the shareholder desk, tonight's read) collapses underneath.
// v1 digests (no tickers[]) fall back to the old section list.

import {
  root, api, el, md, blockMd, lsGet, lsSet, go, todayIso, fmtDay, fmtWeekday, fmtBuilt,
  appFooter, emptyState, renderDays, isTab, pruneDated,
} from "./core.js";

const DOT = { HOLDING: "hold", WATCH: "watch", FIRED: "fired" };

export function open(parts) { load((parts && parts[1]) || ""); }

function load(dateOrEmpty) {
  const qd = dateOrEmpty || "";
  const cacheKey = "crystal.markets." + (qd || "last");
  const cached = lsGet(cacheKey, null);
  if (cached) renderMarkets(cached, qd, "");
  api("/markets" + (qd ? "?date=" + qd : ""))
    .then((data) => {
      lsSet(cacheKey, data);
      if (!qd) lsSet("crystal.markets." + data.date, data);
      pruneDated();
      renderMarkets(data, qd, "");
    })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { renderMarkets(null, qd, ""); return; }
      if (cached) renderMarkets(cached, qd, "Offline. Showing the cached digest.");
      else renderMarkets(null, qd, "Needs signal to fetch the digest.");
    });
}

// The date this render was requested for must still be the date on screen.
// isTab() only checks the TAB, so a slow answer for Monday could land after the
// user tapped today and repaint Monday, then relabel the day row to agree with
// itself: internally consistent, wrong, and no tell. That is the exact bug this
// file was changed to kill, coming back on one bar of signal.
const hashDate = () => location.hash.split("/")[2] || "";

function renderMarkets(data, qd, note) {
  if (!isTab("markets") || qd !== hashDate()) return;
  root.innerHTML = "";
  const head = el("header", {});
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · markets"));
  head.appendChild(el("h1", {}, "The Terminal"));
  root.appendChild(head);

  const current = qd || (data ? data.date : todayIso());
  // Always route to the explicit date, today included. Routing today to the
  // bare "latest" hash re-served whatever digest happened to be newest, so on
  // a night the pipeline missed, tapping today silently redisplayed yesterday.
  // Asking for the date says "nothing was pushed" instead of lying quietly.
  root.appendChild(renderDays(current, (dOrEmpty, iso) => go("#/markets/" + iso)));

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (!data) {
    const isToday = qd === todayIso();
    root.appendChild(emptyState("📈", isToday ? "Not written yet" : qd ? "No digest for this day" : "No digest yet",
      isToday ? "Tonight's edition has not been pushed. It lands about 30 minutes after the close, and a missed run leaves this empty rather than showing you yesterday."
      : qd ? "Nothing was pushed on " + md(qd) + ". Weekends and holidays have no edition."
           : "The evening edition lands after market close, once the digest pipeline pushes."));
    root.appendChild(appFooter(() => load(qd)));
    return;
  }

  const panel = el("section", { class: "term" });
  const th = el("div", { class: "th" });
  th.appendChild(el("span", {}, fmtDay(data.date)));
  th.appendChild(el("b", {}, data.built ? fmtBuilt(data.built) : ""));
  panel.appendChild(th);

  // LOYALIST 4: never render a stale digest as if it were live
  if (data.date < todayIso()) {
    panel.appendChild(el("div", { class: "shut" }, fmtWeekday(data.date) + "'s close. Markets shut."));
  }

  const tickers = Array.isArray(data.tickers) ? data.tickers : [];
  if (tickers.length) {
    const grid = el("div", { class: "tkgrid" });
    const body = el("div", { class: "tkbody" });
    body.hidden = true;
    let openSym = "";
    tickers.forEach((t) => {
      const move = typeof t.movePct === "number" ? t.movePct : (typeof t.move === "number" ? t.move : null);
      const dot = DOT[String(t.status || "").toUpperCase()] || "";
      // a fired breaker is the one thing on this grid that must survive being
      // glanced at, so the whole chip shifts, not just the dot
      const chip = el("button", {
        type: "button", class: "tkchip" + (dot === "fired" ? " fired" : ""), "aria-expanded": "false",
      });
      const sym = el("span", { class: "sym" });
      sym.appendChild(el("span", { class: "dot " + dot }));
      sym.appendChild(el("span", {}, md(t.ticker)));
      chip.appendChild(sym);
      chip.appendChild(el("span", { class: "px" },
        t.close === undefined || t.close === null ? "--" : md(String(t.close))));
      chip.appendChild(el("span", { class: "mv " + (move > 0 ? "up" : move < 0 ? "down" : "") },
        move === null ? "" : (move > 0 ? "+" : "") + move.toFixed(2) + "%"));
      chip.addEventListener("click", () => {
        grid.querySelectorAll(".tkchip").forEach((c) => c.setAttribute("aria-expanded", "false"));
        if (openSym === t.ticker) { openSym = ""; body.hidden = true; return; }
        openSym = t.ticker;
        chip.setAttribute("aria-expanded", "true");
        body.innerHTML = "";
        body.appendChild(el("h4", {}, md(t.ticker) + (t.status ? " · " + md(t.status) : "")));
        blockMd(body, t.md || "Nothing filed on this name tonight.");
        body.hidden = false;
      });
      grid.appendChild(chip);
    });
    panel.appendChild(grid);
    panel.appendChild(body);
    const legend = el("div", { class: "tklegend" });
    [["hold", "holding"], ["watch", "watch"], ["fired", "breaker fired"]].forEach((l) => {
      const s = el("span", {});
      s.appendChild(el("i", { class: "dot " + l[0] }));
      s.appendChild(el("span", {}, l[1]));
      legend.appendChild(s);
    });
    panel.appendChild(legend);
  }
  root.appendChild(panel);

  // sections: everything that is not a per-ticker box, collapsed under the panel
  const folds = lsGet("crystal.mfold", {});
  (data.sections || []).forEach((sec) => {
    if (sec.id === "breakers") return; // the dots already say it
    const d = el("details", { class: "msec" });
    if (!tickers.length && !folds[sec.id]) d.setAttribute("open", "");
    d.addEventListener("toggle", () => {
      const f = lsGet("crystal.mfold", {});
      if (d.open) delete f[sec.id]; else f[sec.id] = true;
      lsSet("crystal.mfold", f);
    });
    const sum = el("summary", {});
    sum.appendChild(el("span", { class: "t" }, md(sec.title)));
    d.appendChild(sum);
    const body = el("div", { class: "cardbody" });
    blockMd(body, sec.md);
    d.appendChild(body);
    root.appendChild(d);
  });

  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(() => load(qd)));
}
