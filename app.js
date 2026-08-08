// Crystal: phone command center. Four sections behind one masthead:
// Today (the daily brief board), News (the dispatch), Markets (the evening
// edition), Money (the ledger). This repo is a shell: no content, no names,
// no data. Everything arrives at runtime from a private Cloudflare Worker,
// gated by a key the user pastes once.
"use strict";

var WORKER = "https://crystal-brief.janniksin.workers.dev";
var root = document.getElementById("root");
var tabbar = document.getElementById("tabbar");
var HISTORY_DAYS = 8; // today + 7 back in the switchers

// ---------- tiny storage helpers ----------
function lsGet(k, fallback) {
  try { var v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function key() {
  return localStorage.getItem("crystal.key") || localStorage.getItem("brief.key") || "";
}

// ---------- inline markdown (escape first; content is the owner's own) ----------
function md(s) {
  s = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(?!\s)(.+?)(?<!\s)\*/g, "<em>$1</em>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // URLs may not contain quotes or angle brackets, so a crafted "link" can
  // never escape the href attribute (content is escaped above regardless).
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"'<>`]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[^"=>])\b(https?:\/\/[^\s<)\]"'`]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  s = s.replace(/«([^»]+)»/g, '<span class="wiki">$1</span>');
  return s;
}

// block markdown for the market digest sections: bullets and paragraphs
function blockMd(container, text) {
  var lines = String(text || "").split(/\r?\n/);
  var ul = null;
  lines.forEach(function (line) {
    var t = line.trim();
    if (!t) { ul = null; return; }
    if (/^[-*] /.test(t)) {
      if (!ul) { ul = el("ul", {}); container.appendChild(ul); }
      ul.appendChild(el("li", {}, md(t.slice(2))));
      return;
    }
    ul = null;
    if (/^#{1,4} /.test(t)) {
      container.appendChild(el("h4", {}, md(t.replace(/^#+ /, ""))));
      return;
    }
    container.appendChild(el("p", {}, md(t)));
  });
}

// ---------- dates + formats ----------
function isoOf(d) {
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function todayIso() { return isoOf(new Date()); }
function nowIso() {
  var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
  return isoOf(d) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
function fmtBuilt(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return "";
  var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return "built " + h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
}
function fmtDay(iso) {
  var d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function fmtMoney(v, cents) {
  if (typeof v !== "number" || !isFinite(v)) return "--";
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: cents === false ? 0 : 2,
    maximumFractionDigits: cents === false ? 0 : 2,
  });
}
function fmtPct(p) {
  if (typeof p !== "number" || !isFinite(p)) return "--";
  return (p >= 0 ? "+" : "") + (p * 100).toFixed(2) + "%";
}
function arrowOf(v) { return v > 0 ? "▲" : v < 0 ? "▼" : "•"; }
function dirClass(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }
function daysUntil(iso) {
  return Math.ceil((new Date(iso + "T00:00:00") - new Date()) / 86400000);
}

// ---------- outbound queue: ticks, captures, news reads share one pipe ----------
var flushing = false;

function ticksKey(date) { return "brief.ticks." + date; }
function localTicks(date) { return lsGet(ticksKey(date), {}); }

function setTick(date, id, done, extra) {
  var t = localTicks(date);
  if (done) t[id] = Object.assign({ done: true, at: nowIso() }, extra || {});
  else delete t[id];
  lsSet(ticksKey(date), t);
  var q = lsGet("brief.queue", []);
  // replace any queued delta for the same box; only the last state matters
  q = q.filter(function (d) {
    return d.type !== "tick" || !(d.date === date && d.id === id);
  });
  q.push(Object.assign({ type: "tick", date: date, id: id, done: done, at: nowIso() }, extra || {}));
  lsSet("brief.queue", q);
  flush();
}

function queueCapture(text) {
  var date = todayIso();
  var item = { type: "capture", date: date, text: text, at: nowIso() };
  var q = lsGet("brief.queue", []);
  q.push(item);
  lsSet("brief.queue", q);
  var caps = lsGet("brief.caps." + date, []);
  caps.push({ text: text, at: item.at, sent: false });
  lsSet("brief.caps." + date, caps);
  flush();
}

function readSetOf(date) { return lsGet("crystal.read." + date, []); }

function markRead(date, ids) {
  var cur = readSetOf(date);
  var set = {};
  cur.forEach(function (i) { set[i] = true; });
  var add = ids.filter(function (i) { return !set[i]; });
  if (!add.length) return;
  lsSet("crystal.read." + date, cur.concat(add));
  var q = lsGet("brief.queue", []);
  var found = null;
  q.forEach(function (d) { if (d.type === "newsread" && d.date === date) found = d; });
  if (found) {
    add.forEach(function (i) { if (found.ids.indexOf(i) < 0) found.ids.push(i); });
  } else {
    q.push({ type: "newsread", date: date, ids: add });
  }
  lsSet("brief.queue", q);
  flush();
}

function markCapSent(d) {
  var caps = lsGet("brief.caps." + d.date, []);
  caps.forEach(function (c) { if (c.at === d.at && c.text === d.text) c.sent = true; });
  lsSet("brief.caps." + d.date, caps);
  var list = document.getElementById("caplist");
  if (list) renderCapList(list);
}

function flush() {
  if (flushing) return;
  var q = lsGet("brief.queue", []);
  if (!q.length) { syncStamp("synced"); return; }
  if (!navigator.onLine) { syncStamp(q.length + " waiting for signal"); return; }
  flushing = true;
  var d = q[0];
  var path = d.type === "capture" ? "/capture" : d.type === "newsread" ? "/newsread" : "/ticks";
  var body = d.type === "capture" ? { date: d.date, text: d.text, at: d.at }
    : d.type === "newsread" ? { date: d.date, ids: d.ids }
    : d;
  fetch(WORKER + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-brief-key": key() },
    body: JSON.stringify(body),
  }).then(function (r) {
    flushing = false;
    if (r.ok || r.status === 400) {
      // 400 = the Worker rejected the payload itself; retrying forever would
      // wedge the queue behind it, so drop it and move on
      var q2 = lsGet("brief.queue", []);
      q2.shift();
      lsSet("brief.queue", q2);
      if (r.ok && d.type === "capture") markCapSent(d);
      flush();
    } else {
      syncStamp(q.length + " not synced (" + r.status + ")");
    }
  }).catch(function () {
    flushing = false;
    syncStamp(q.length + " saved on phone, will sync");
  });
}
window.addEventListener("online", flush);

function syncStamp(text) {
  var elx = document.getElementById("sync");
  if (elx) elx.textContent = text;
}

// ---------- api ----------
function api(path) {
  return fetch(WORKER + path, { headers: { "x-brief-key": key() } }).then(function (r) {
    if (r.status === 401) { keyScreen("That key was refused."); throw "auth"; }
    if (r.status === 404) throw "empty";
    if (!r.ok) throw "http " + r.status;
    return r.json();
  });
}

// ---------- dom ----------
function el(tag, attrs, html) {
  var e = document.createElement(tag);
  for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>';

// ---------- router ----------
var currentTab = "today";

function go(hash) { location.hash = hash; }

function route() {
  if (!key()) { keyScreen(""); return; }
  tabbar.hidden = false;
  var h = location.hash.replace(/^#\/?/, "");
  var parts = h.split("/").map(decodeURIComponent).filter(Boolean);
  var tab = parts[0] || "today";
  if (["today", "news", "markets", "money"].indexOf(tab) < 0) tab = "today";
  currentTab = tab;
  tabbar.querySelectorAll("button").forEach(function (b) {
    b.setAttribute("aria-current", b.getAttribute("data-tab") === tab ? "true" : "false");
  });
  window.scrollTo(0, 0);
  if (tab === "today") loadToday(false);
  else if (tab === "news") parts[1] ? openStory(parts[1]) : loadNews(false);
  else if (tab === "markets") loadMarkets(parts[1] || "");
  else if (tab === "money") parts[1] ? loadMoneyDetail(parts[1].toUpperCase()) : loadMoney(false);
}

tabbar.querySelectorAll("button").forEach(function (b) {
  b.addEventListener("click", function () { go("#/" + b.getAttribute("data-tab")); });
});
window.addEventListener("hashchange", route);

// masthead shared by News / Markets / Money
function mastHead(section, title, sub) {
  var head = el("header", {});
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · " + section));
  head.appendChild(el("h1", {}, title));
  if (sub) head.appendChild(el("div", { class: "strap" }, sub));
  return head;
}

function appFooter(refreshFn) {
  var f = el("footer", { class: "app" });
  f.appendChild(el("div", {}, "Captured. You do not carry it."));
  var btns = el("div", { class: "btns" });
  var re = el("button", { type: "button" }, "Refresh");
  re.addEventListener("click", refreshFn);
  var ck = el("button", { type: "button" }, "Change key");
  ck.addEventListener("click", function () { keyScreen(""); });
  btns.appendChild(re);
  btns.appendChild(ck);
  f.appendChild(btns);
  return f;
}

function emptyState(glyph, title, text) {
  var d = el("div", { class: "emptybig" });
  d.appendChild(el("div", { class: "glyph" }, glyph));
  d.appendChild(el("h3", {}, title));
  d.appendChild(el("p", {}, text));
  return d;
}

// ============================================================
// TODAY: the brief board (ported intact from Brief v2)
// ============================================================
var brief = null;
var todayViewDate = ""; // "" = latest; else "YYYY-MM-DD" picked in the switcher

function cacheBrief(data) {
  if (!data || !data.date) return;
  lsSet("brief.day." + data.date, data);
  var cut = new Date(); cut.setDate(cut.getDate() - (HISTORY_DAYS + 1));
  var cutIso = isoOf(cut);
  for (var i = localStorage.length - 1; i >= 0; i--) {
    var k = localStorage.key(i);
    if (k && k.indexOf("brief.day.") === 0 && k.slice(10) < cutIso) lsDel(k);
  }
}

function foldKey(title) {
  // "Aerospace edge (from the 2026-08-02 brief)" folds like "Aerospace edge"
  return String(title).replace(/\(.*$/, "").trim();
}

function tickRow(date, id, textHtml, checked, extra, cls) {
  var lab = el("label", { class: "tick" + (cls ? " " + cls : "") + (checked ? " done" : "") });
  var box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", function () {
    setTick(date, id, box.checked, extra);
    lab.classList.toggle("done", box.checked);
    var card = lab.closest("details.card");
    if (card && cls === "cardtick") card.classList.toggle("done", box.checked);
    if (card) cardCount(card);
    tally();
  });
  lab.appendChild(box);
  lab.appendChild(el("span", { class: "box" }, CHECK_SVG));
  lab.appendChild(el("span", { class: "txt" }, textHtml));
  return lab;
}

function cardCount(card) {
  var boxes = card.querySelectorAll("input[type=checkbox]");
  var n = card.querySelector("summary .n");
  if (!boxes.length || !n) { if (n) n.textContent = ""; return; }
  var done = 0;
  boxes.forEach(function (b) { if (b.checked) done++; });
  n.textContent = done + "/" + boxes.length;
  n.classList.toggle("full", done === boxes.length);
}

function tally() {
  var boxes = document.querySelectorAll("#app input[type=checkbox]");
  var done = 0;
  boxes.forEach(function (b) { if (b.checked) done++; });
  var nd = document.getElementById("ndone"), nt = document.getElementById("ntot");
  if (nd) { nd.textContent = done; nt.textContent = boxes.length; }
  var fill = document.getElementById("fill");
  if (fill) fill.style.width = (boxes.length ? Math.round(done / boxes.length * 100) : 0) + "%";
}

function renderDays(current, onPick) {
  var row = el("div", { class: "days", role: "tablist", "aria-label": "Day" });
  for (var back = 0; back < HISTORY_DAYS; back++) {
    (function (back) {
      var d = new Date(); d.setDate(d.getDate() - back);
      var iso = isoOf(d);
      var b = el("button", { type: "button", "aria-current": iso === current ? "true" : "false" },
        '<span class="dw">' + (back === 0 ? "today" : d.toLocaleDateString("en-US", { weekday: "short" })) +
        '</span><span class="dn">' + d.getDate() + "</span>");
      b.addEventListener("click", function () { onPick(back === 0 ? "" : iso, iso); });
      row.appendChild(b);
    })(back);
  }
  return row;
}

function renderScoreboard(rows) {
  var t = el("section", { class: "score" });
  t.appendChild(el("div", { class: "eyebrow" }, "scoreboard · this week"));
  rows.forEach(function (r) {
    var row = el("div", { class: "row" });
    row.appendChild(el("span", { class: "num" }, md(r.week)));
    row.appendChild(el("span", { class: "lbl" }, md(r.label)));
    if (r.goal) row.appendChild(el("span", { class: "goal" }, md(r.goal)));
    t.appendChild(row);
  });
  return t;
}

function renderCapList(list) {
  list.innerHTML = "";
  var caps = lsGet("brief.caps." + todayIso(), []);
  caps.slice(-6).reverse().forEach(function (c) {
    var li = el("li", {});
    li.appendChild(el("span", { class: "at" },
      (c.sent ? "✓" : "…") + " " + (c.at || "").slice(11, 16)));
    li.appendChild(el("span", {}, md(c.text.length > 90 ? c.text.slice(0, 90) + "..." : c.text)));
    list.appendChild(li);
  });
}

function renderCapture() {
  var box = el("section", { class: "capture" });
  box.appendChild(el("h2", {}, "🪞 Tell Crystal"));
  box.appendChild(el("p", { class: "hint" },
    "Type it and let it go. It lands in the vault with the morning pull."));
  var ta = document.createElement("textarea");
  ta.placeholder = "A thought, a task, a thing to file...";
  ta.setAttribute("aria-label", "Tell Crystal");
  box.appendChild(ta);
  var row = el("div", { class: "row" });
  var stat = el("span", { class: "stat" }, "");
  var send = el("button", { type: "button", class: "send" }, "Send");
  send.addEventListener("click", function () {
    var text = ta.value.trim();
    if (!text) return;
    queueCapture(text);
    ta.value = "";
    stat.textContent = "captured";
    setTimeout(function () { stat.textContent = ""; }, 2500);
    renderCapList(list);
  });
  row.appendChild(stat);
  row.appendChild(send);
  box.appendChild(row);
  var list = el("ul", { class: "caplist", id: "caplist" });
  renderCapList(list);
  box.appendChild(list);
  return box;
}

function renderToday(offlineNote, emptyDayNote) {
  root.innerHTML = "";

  var head = el("header", {});
  var stamp = brief ? fmtBuilt(brief.built) : "";
  head.appendChild(el("div", { class: "eyebrow" },
    "🔮 crystal · today" + (stamp ? " · " + stamp : "")));
  if (brief) {
    var day = String(brief.day || "").replace(/,\s*\d{4}\s*$/, "").replace(/ 0(\d)/, " $1");
    head.appendChild(el("h1", {}, md(day)));
    if (brief.strap) head.appendChild(el("div", { class: "strap" }, md(brief.strap)));
  } else {
    head.appendChild(el("h1", {}, "Today"));
  }
  head.appendChild(el("div", { class: "dawn" }, '<i id="fill"></i>'));
  head.appendChild(el("div", { class: "meter" },
    '<span><b id="ndone">0</b> of <b id="ntot">0</b> closed</span><span id="sync"></span>'));
  root.appendChild(head);

  var latestDate = (lsGet("brief.last", null) || {}).date || todayIso();
  root.appendChild(renderDays(todayViewDate || latestDate, function (dateOrEmpty) {
    pickDay(dateOrEmpty);
  }));

  if (offlineNote) root.appendChild(el("div", { class: "banner" }, offlineNote));
  if (brief && todayViewDate && todayViewDate !== todayIso()) {
    var backBanner = el("div", { class: "banner" },
      "Reading " + md(brief.day) + ". Ticks still count for that day. ");
    var backBtn = el("button", { type: "button" }, "Back to today");
    backBtn.addEventListener("click", function () { pickDay(""); });
    backBanner.appendChild(backBtn);
    root.appendChild(backBanner);
  } else if (brief && !todayViewDate && brief.date !== todayIso()) {
    root.appendChild(el("div", { class: "banner" },
      "This brief is from " + md(brief.day) + ", not today. Open with signal to refresh."));
  }

  if (brief && brief.scoreboard && brief.scoreboard.length) {
    root.appendChild(renderScoreboard(brief.scoreboard));
  }

  var app = el("div", { id: "app" });
  if (!brief) {
    app.appendChild(el("p", { class: "empty" },
      emptyDayNote || "No brief cached yet. Open with signal once."));
    root.appendChild(app);
    root.appendChild(renderCapture());
    root.appendChild(appFooter(function () { pickDay(todayViewDate, true); }));
    return;
  }

  var date = brief.date;
  var local = localTicks(date);
  var folds = lsGet("brief.fold", {});

  (brief.cards || []).forEach(function (card) {
    var fk = foldKey(card.title);
    var d = el("details", { class: "card" });
    if (!folds[fk]) d.setAttribute("open", "");
    d.addEventListener("toggle", function () {
      var f = lsGet("brief.fold", {});
      if (d.open) delete f[fk]; else f[fk] = true;
      lsSet("brief.fold", f);
    });
    var sum = el("summary", {});
    sum.appendChild(el("span", { class: "t" }, md(card.title)));
    sum.appendChild(el("span", { class: "n" }, ""));
    d.appendChild(sum);
    var body = el("div", { class: "cardbody" });

    if (card.tick) {
      var cchecked = card.tick.checked || !!(local[card.tick.id] || {}).done;
      body.appendChild(tickRow(date, card.tick.id, md(card.tick.label), cchecked, {
        kind: card.kind || "action", section: card.title,
        label: card.tick.label, target: card.tick.target || "",
      }, "cardtick"));
      if (cchecked) d.classList.add("done");
    }

    var ul = null;
    (card.blocks || []).forEach(function (b) {
      if (b.t === "li") {
        if (!ul) { ul = el("ul", {}); body.appendChild(ul); }
        ul.appendChild(el("li", {}, md(b.md)));
        return;
      }
      ul = null;
      if (b.t === "tick") {
        var checked = b.checked || !!(local[b.id] || {}).done;
        body.appendChild(tickRow(date, b.id, md(b.md), checked, {
          kind: "task", section: card.title, label: b.md.slice(0, 120),
        }));
      } else {
        body.appendChild(el("p", b.t === "num" ? { class: "num" } : {}, md(b.md)));
      }
    });
    d.appendChild(body);
    app.appendChild(d);
    cardCount(d);
  });
  root.appendChild(app);
  root.appendChild(renderCapture());
  root.appendChild(appFooter(function () { pickDay(todayViewDate, true); }));
  tally();
  flush();
}

function pickDay(date, force) {
  todayViewDate = date || "";
  if (!todayViewDate) { loadToday(true); return; }
  var cached = lsGet("brief.day." + todayViewDate, null);
  if (cached && !force) { brief = cached; renderToday(""); return; }
  api("/brief?date=" + todayViewDate)
    .then(function (data) {
      brief = data;
      cacheBrief(data);
      renderToday("");
    })
    .catch(function (e) {
      if (e === "auth") return;
      if (e === "empty") { brief = null; renderToday("", "No brief was pushed on this day."); return; }
      if (cached) { brief = cached; renderToday("Offline. Showing the cached copy."); }
      else { brief = null; renderToday("", "Needs signal to fetch this day."); }
    });
}

function loadToday(force) {
  todayViewDate = "";
  brief = lsGet("brief.last", null);
  if (brief && !force) renderToday(""); // fast paint from cache, then refresh below
  api("/brief")
    .then(function (data) {
      brief = data;
      lsSet("brief.last", data);
      cacheBrief(data);
      renderToday("");
    })
    .catch(function (e) {
      if (e === "auth") return;
      if (e === "empty") {
        if (!brief) renderToday("", "No brief has been pushed yet. It lands with the morning build.");
        return;
      }
      if (brief) renderToday("Offline. Showing the last cached brief.");
      else renderToday("");
    });
}

// ============================================================
// NEWS: the dispatch
// ============================================================
var news = null; // latest edition payload

var CAT_ORDER = ["ai", "aero", "world", "energy", "sports"];
var CAT_LABEL = {
  ai: "AI / Tech", aero: "Aerospace / Defense", world: "World / Politics",
  energy: "Energy / Nuclear", sports: "Sports",
};
function catKey(cat) {
  var c = String(cat || "").toLowerCase();
  if (/aero|defen|space/.test(c)) return "aero";
  if (/ai|tech/.test(c)) return "ai";
  if (/world|politic|geo/.test(c)) return "world";
  if (/energy|nuclear|power/.test(c)) return "energy";
  if (/sport/.test(c)) return "sports";
  return c;
}
function catLabel(cat) { return CAT_LABEL[catKey(cat)] || String(cat); }

var NEWS_CAP = 20;

// batch 0 = front page, one per category by rank; then ranked chunks of 5
function newsBatches(stories) {
  var sorted = stories.slice().sort(function (a, b) { return a.rank - b.rank; });
  var used = {};
  var front = [];
  CAT_ORDER.forEach(function (c) {
    for (var i = 0; i < sorted.length; i++) {
      if (!used[sorted[i].id] && catKey(sorted[i].cat) === c) {
        front.push(sorted[i]); used[sorted[i].id] = true; return;
      }
    }
  });
  // odd categories (payload used a cat outside the five): fill the front page
  if (front.length < 5) {
    for (var i = 0; i < sorted.length && front.length < 5; i++) {
      if (!used[sorted[i].id]) { front.push(sorted[i]); used[sorted[i].id] = true; }
    }
  }
  var rest = sorted.filter(function (s) { return !used[s.id]; });
  var batches = front.length ? [front] : [];
  while (rest.length) batches.push(rest.splice(0, 5));
  return batches;
}

function loadNews(force) {
  var cached = lsGet("crystal.news.last", null);
  if (cached && !force) { news = cached; renderNews(""); }
  api("/news")
    .then(function (data) {
      news = data;
      lsSet("crystal.news.last", data);
      // merge the server's read set for this edition
      api("/newsread?date=" + data.date).then(function (r) {
        if (r.ids && r.ids.length) {
          var cur = readSetOf(data.date);
          var have = {};
          cur.forEach(function (i) { have[i] = true; });
          var merged = cur.concat(r.ids.filter(function (i) { return !have[i]; }));
          lsSet("crystal.read." + data.date, merged);
        }
        if (currentTab === "news" && !location.hash.match(/#\/news\/./)) renderNews("");
      }).catch(function () {});
      if (currentTab === "news" && !location.hash.match(/#\/news\/./)) renderNews("");
    })
    .catch(function (e) {
      if (e === "auth") return;
      if (e === "empty") { news = null; renderNews("", true); return; }
      if (cached) { news = cached; renderNews("Offline. Showing the cached edition."); }
      else renderNews("", true);
    });
}

function renderNews(offlineNote, noEdition) {
  if (currentTab !== "news") return;
  root.innerHTML = "";
  var sub = news ? fmtDay(news.date) + (news.built ? " · " + fmtBuilt(news.built) : "") : "";
  root.appendChild(mastHead("news", "The Dispatch", sub));

  if (offlineNote) root.appendChild(el("div", { class: "banner" }, offlineNote));

  if (noEdition || !news) {
    root.appendChild(emptyState("🗞", "No edition yet",
      "The news desk publishes with the morning build. Nothing has been pushed."));
    root.appendChild(appFooter(function () { loadNews(true); }));
    return;
  }

  var date = news.date;
  var read = {};
  readSetOf(date).forEach(function (i) { read[i] = true; });
  var batches = newsBatches(news.stories || []);
  var shownBatches = Math.max(1, lsGet("crystal.newsbatch." + date, 1));

  var totalStories = (news.stories || []).length;
  var capBatches = 1;
  var count = batches.length ? batches[0].length : 0;
  for (var i = 1; i < batches.length; i++) {
    if (count + batches[i].length > NEWS_CAP) break;
    count += batches[i].length;
    capBatches++;
  }
  shownBatches = Math.min(shownBatches, capBatches);

  var list = el("div", {});
  var visibleIds = [];
  for (var b = 0; b < shownBatches && b < batches.length; b++) {
    if (b > 0) list.appendChild(el("div", { class: "batchrule" }, "more of the day"));
    batches[b].forEach(function (s) {
      visibleIds.push(s.id);
      var item = el("article", { class: "fp" + (read[s.id] ? " read" : ""), role: "button", tabindex: "0" });
      item.appendChild(el("div", { class: "cat" },
        catLabel(s.cat) + (read[s.id] ? '<span class="rmark">✓ read</span>' : "")));
      item.appendChild(el("h3", {}, md(s.headline)));
      item.appendChild(el("p", { class: "one" }, md(s.oneLiner)));
      var open = function () { go("#/news/" + encodeURIComponent(s.id)); };
      item.addEventListener("click", open);
      item.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
      list.appendChild(item);
    });
  }
  root.appendChild(list);

  var shownCount = visibleIds.length;
  var remaining = totalStories - shownCount;
  var canReveal = shownBatches < capBatches;
  if (canReveal) {
    var more = el("button", { type: "button", class: "morebtn" }, "Read 5 more ↓");
    more.addEventListener("click", function () {
      // advancing the batch marks everything currently on the page as read
      markRead(date, visibleIds);
      lsSet("crystal.newsbatch." + date, shownBatches + 1);
      renderNews("");
    });
    root.appendChild(more);
  }
  var notShown = (news.notShownCount || 0) + (canReveal ? 0 : remaining);
  if (!canReveal && notShown > 0) {
    root.appendChild(el("p", { class: "notshown" },
      notShown + " more stor" + (notShown === 1 ? "y" : "ies") + " ranked below the cut, not shown."));
  } else if (canReveal && news.notShownCount > 0) {
    root.appendChild(el("p", { class: "notshown" },
      news.notShownCount + " more beyond the edition, not shown."));
  }

  root.appendChild(appFooter(function () { loadNews(true); }));
}

function openStory(id) {
  if (!news) {
    var cached = lsGet("crystal.news.last", null);
    if (cached) { news = cached; }
    else {
      api("/news").then(function (data) {
        news = data; lsSet("crystal.news.last", data); openStory(id);
      }).catch(function () { go("#/news"); });
      return;
    }
  }
  var story = null;
  (news.stories || []).forEach(function (s) { if (s.id === id) story = s; });
  if (!story) { go("#/news"); return; }
  markRead(news.date, [id]); // opening a story marks it read
  renderStory(story);
}

function renderStory(s) {
  root.innerHTML = "";
  var back = el("button", { type: "button", class: "backbtn" }, "← the dispatch");
  back.addEventListener("click", function () { go("#/news"); });
  root.appendChild(back);

  var art = el("article", { class: "art" });
  art.appendChild(el("div", { class: "eyebrow" }, catLabel(s.cat)));
  art.appendChild(el("h2", {}, md(s.headline)));
  art.appendChild(el("p", { class: "one" }, md(s.oneLiner)));

  // score chip: one number; tap opens the working
  var chipRow = el("div", { style: "margin:10px 0 2px" });
  var chip = el("button", { type: "button", class: "scorechip", "aria-expanded": "false" },
    '<span class="v">' + s.score + '</span><span class="cap">/ 100 · tap for the working</span>');
  chipRow.appendChild(chip);
  art.appendChild(chipRow);
  var subs = el("div", { class: "subscores", hidden: "" });
  var d = s.scoreDetail || {};
  [["Reliability", d.reliability, "rel"], ["Charge", d.charge, "chg"]].forEach(function (row) {
    var sub = el("div", { class: "sub" });
    sub.appendChild(el("div", { class: "subhead" },
      "<span>" + row[0] + "</span><b>" + (row[1] != null ? row[1] : "--") + "</b>"));
    sub.appendChild(el("div", { class: "bar " + row[2] },
      '<i style="width:' + (row[1] || 0) + '%"></i>'));
    subs.appendChild(sub);
  });
  if (d.reasoning) subs.appendChild(el("p", { class: "reason" }, md(d.reasoning)));
  subs.appendChild(el("div", { class: "aiest" }, "AI-estimated, not a fact"));
  art.appendChild(subs);
  chip.addEventListener("click", function () {
    var open = subs.hasAttribute("hidden");
    if (open) subs.removeAttribute("hidden"); else subs.setAttribute("hidden", "");
    chip.setAttribute("aria-expanded", open ? "true" : "false");
  });

  if (s.facts && s.facts.length) {
    art.appendChild(el("h4", {}, "What happened"));
    var ul = el("ul", {});
    s.facts.forEach(function (f) { ul.appendChild(el("li", {}, md(f))); });
    art.appendChild(ul);
  }
  if (s.context) {
    art.appendChild(el("h4", {}, "Context"));
    art.appendChild(el("p", {}, md(s.context)));
  }
  if (s.whyItMatters) {
    art.appendChild(el("h4", {}, "Why it matters to you"));
    art.appendChild(el("div", { class: "why" }, md(s.whyItMatters)));
  }

  if (s.contested) {
    var con = el("div", { class: "contested" });
    con.appendChild(el("h5", {}, "Contested: fact vs readings"));
    con.appendChild(el("div", {}, "The facts above are agreed. What they mean is not:"));
    var cul = el("ul", {});
    (s.interpretations || []).forEach(function (t) { cul.appendChild(el("li", {}, md(t))); });
    con.appendChild(cul);
    art.appendChild(con);
  }

  art.appendChild(el("h4", {}, "Sources"));
  var panel = el("div", { class: "srcpanel" });
  var badges = el("div", { class: "chips", style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" });
  badges.appendChild(el("span", { class: "badge violet" }, "seen in " + s.sourceCount + " source" + (s.sourceCount === 1 ? "" : "s")));
  if (s.crossSector) badges.appendChild(el("span", { class: "badge gold" }, "cross-sector"));
  (s.tickerTags || []).forEach(function (t) {
    badges.appendChild(el("span", { class: "badge" }, "$" + t));
  });
  panel.appendChild(badges);
  (s.sources || []).forEach(function (src) {
    var row = el("div", { class: "src" });
    row.appendChild(el("b", {}, md(src.name)));
    if (src.note) row.appendChild(el("span", {}, md(src.note)));
    panel.appendChild(row);
  });
  art.appendChild(panel);

  root.appendChild(art);
  root.appendChild(appFooter(function () { loadNews(true); go("#/news"); }));
}

// ============================================================
// MARKETS: the evening edition
// ============================================================
function loadMarkets(dateOrEmpty) {
  var qd = dateOrEmpty || "";
  var cacheKey = "crystal.markets." + (qd || "last");
  var cached = lsGet(cacheKey, null);
  if (cached) renderMarkets(cached, qd, "");
  api("/markets" + (qd ? "?date=" + qd : ""))
    .then(function (data) {
      lsSet(cacheKey, data);
      if (!qd) lsSet("crystal.markets." + data.date, data);
      renderMarkets(data, qd, "");
    })
    .catch(function (e) {
      if (e === "auth") return;
      if (e === "empty") { renderMarkets(null, qd, ""); return; }
      if (cached) renderMarkets(cached, qd, "Offline. Showing the cached digest.");
      else renderMarkets(null, qd, "Needs signal to fetch the digest.");
    });
}

function renderMarkets(data, qd, note) {
  if (currentTab !== "markets") return;
  root.innerHTML = "";
  var sub = data ? fmtDay(data.date) + (data.built ? " · " + fmtBuilt(data.built) : "") : "";
  root.appendChild(mastHead("markets", "The Evening Edition", sub));

  var current = qd || (data ? data.date : todayIso());
  root.appendChild(renderDays(current, function (dateOrEmpty, iso) {
    go("#/markets" + (dateOrEmpty ? "/" + iso : ""));
  }));

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (!data) {
    root.appendChild(emptyState("📈", qd ? "No digest for this day" : "No digest yet",
      qd ? "Nothing was pushed on " + qd + ". Weekends and holidays have no edition."
         : "The evening edition lands after market close, once the digest pipeline pushes."));
    root.appendChild(appFooter(function () { loadMarkets(qd); }));
    return;
  }

  var folds = lsGet("crystal.mfold", {});
  (data.sections || []).forEach(function (sec) {
    var d = el("details", { class: "card" });
    if (!folds[sec.id]) d.setAttribute("open", "");
    d.addEventListener("toggle", function () {
      var f = lsGet("crystal.mfold", {});
      if (d.open) delete f[sec.id]; else f[sec.id] = true;
      lsSet("crystal.mfold", f);
    });
    var sum = el("summary", {});
    sum.appendChild(el("span", { class: "t" }, md(sec.title)));
    sum.appendChild(el("span", { class: "n" }, ""));
    d.appendChild(sum);
    var body = el("div", { class: "cardbody" });
    blockMd(body, sec.md);
    d.appendChild(body);
    root.appendChild(d);
  });

  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(function () { loadMarkets(qd); }));
}

// ============================================================
// MONEY: the ledger
// ============================================================
var holdings = null;
var quotes = {};   // SYM -> quote object
var quotesMeta = { stale: false };

function positionTickers() {
  return (holdings && holdings.positions || []).map(function (p) { return p.ticker; });
}

function loadMoney(force) {
  holdings = lsGet("crystal.holdings", null);
  quotes = (lsGet("crystal.quotes", null) || {}).quotes || {};
  if (holdings && !force) renderMoney("");
  api("/holdings")
    .then(function (data) {
      holdings = data;
      lsSet("crystal.holdings", data);
      renderMoney("");
      refreshQuotes();
    })
    .catch(function (e) {
      if (e === "auth") return;
      if (e === "empty") { holdings = null; renderMoney("", true); return; }
      if (holdings) { renderMoney("Offline. Showing cached holdings."); }
      else renderMoney("", true);
    });
}

function refreshQuotes() {
  var syms = positionTickers();
  if (!syms.length) return;
  api("/quotes?symbols=" + syms.join(","))
    .then(function (data) {
      quotes = data.quotes || {};
      quotesMeta.stale = Object.keys(quotes).some(function (s) { return quotes[s] && quotes[s].stale; });
      lsSet("crystal.quotes", { at: data.at, quotes: quotes });
      if (currentTab === "money") {
        var h = location.hash.replace(/^#\/?/, "").split("/");
        if (h[1]) renderMoneyDetail(h[1].toUpperCase()); else renderMoney("");
      }
    })
    .catch(function () {});
}

// reference close for week/month deltas, from /quotehistory (client-cached)
function refPrice(sym, range, cb) {
  var k = "crystal.qh." + sym + "." + range;
  var cached = lsGet(k, null);
  var ttl = range === "1d" ? 15 * 60000 : 6 * 3600000;
  if (cached && Date.now() - cached.at < ttl) { cb(cached.data); return; }
  api("/quotehistory?symbol=" + sym + "&range=" + range)
    .then(function (data) {
      if (data.points && data.points.length) lsSet(k, { at: Date.now(), data: data });
      cb(data);
    })
    .catch(function () { cb(cached ? cached.data : null); });
}

function posValue(pos) {
  var q = quotes[pos.ticker];
  var shares = pos.lots.reduce(function (a, l) { return a + l.shares; }, 0);
  return q && typeof q.price === "number" ? shares * q.price : null;
}
function posShares(pos) { return pos.lots.reduce(function (a, l) { return a + l.shares; }, 0); }
function posBasis(pos) { return pos.lots.reduce(function (a, l) { return a + l.basis; }, 0); }

function deltaHtml(amt, pct, cls) {
  var c = dirClass(pct != null ? pct : amt);
  return '<span class="delta ' + c + (cls ? " " + cls : "") + '">' + arrowOf(pct != null ? pct : amt) +
    (amt != null ? " " + (amt >= 0 ? "+" : "−") + fmtMoney(Math.abs(amt)).slice(1) : "") +
    (pct != null ? " (" + fmtPct(pct) + ")" : "") + "</span>";
}

var SEL_LABEL = { day: "day", week: "week", month: "month", life: "lifetime" };

function gaugeSvg(pct, scale) {
  var R = 27, C = 2 * Math.PI * R;
  var ok = typeof pct === "number" && isFinite(pct);
  var frac = ok ? Math.min(Math.abs(pct) / scale, 1) : 0;
  var cls = ok ? dirClass(pct) : "";
  var color = cls === "up" ? "var(--up)" : cls === "down" ? "var(--down)" : "var(--faint)";
  var label = ok ? arrowOf(pct) + " " + fmtPct(pct) : "--";
  return '<svg width="78" height="78" viewBox="0 0 78 78" role="img" aria-label="' + label + '">' +
    '<circle cx="39" cy="39" r="' + R + '" fill="none" stroke="var(--hairline)" stroke-width="6"/>' +
    (frac > 0 ? '<circle cx="39" cy="39" r="' + R + '" fill="none" stroke="' + color +
      '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' +
      (frac * C).toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 39 39)"/>' : "") +
    '<text x="39" y="43" text-anchor="middle" font-family="ui-monospace,SF Mono,Menlo,monospace"' +
    ' font-size="11.5" font-weight="600" fill="' + color + '">' + label + "</text></svg>";
}

function ltcgBadge(pos) {
  var worst = null; // furthest-out unsold lot
  pos.lots.forEach(function (l) {
    var d = daysUntil(l.ltcgDate);
    if (worst === null || d > worst) worst = d;
  });
  if (worst === null) return "";
  if (worst <= 0) return '<span class="badge up">✓ LTCG</span>';
  return '<span class="badge">sellable in ' + worst + "d</span>";
}

function renderMoney(note, noHoldings) {
  if (currentTab !== "money") return;
  root.innerHTML = "";
  var sub = holdings ? "as of " + String(holdings.asOf).slice(0, 10) : "";
  root.appendChild(mastHead("money", "The Ledger", sub));

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (noHoldings || !holdings) {
    root.appendChild(emptyState("💰", "No holdings yet",
      "The portfolio pipeline has not pushed. Once it does, the dials appear here."));
    root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
    root.appendChild(appFooter(function () { loadMoney(true); }));
    return;
  }

  var sel = lsGet("crystal.moneySel", "day");
  var positions = holdings.positions || [];
  var cash = holdings.cash || [];
  var cashTotal = cash.reduce(function (a, c) { return a + c.amount; }, 0);

  // ---- portfolio header ----
  var totalVal = cashTotal, totalCost = cashTotal, dayAmt = 0, havePrices = true, havePrev = true;
  positions.forEach(function (p) {
    var v = posValue(p);
    totalCost += posBasis(p);
    if (v === null) { havePrices = false; return; }
    totalVal += v;
    var q = quotes[p.ticker];
    if (q && typeof q.prevClose === "number") {
      dayAmt += posShares(p) * (q.price - q.prevClose);
    } else havePrev = false;
  });
  var pf = el("section", { class: "pf" });
  pf.appendChild(el("div", { class: "eyebrow" }, "portfolio" +
    (quotesMeta.stale ? " · quotes stale" : "")));
  pf.appendChild(el("div", { class: "total" }, havePrices ? fmtMoney(totalVal) : "—"));
  var lifeAmt = havePrices ? totalVal - totalCost : null;
  var subrow = el("div", { class: "subrow" });
  subrow.appendChild(el("span", {}, "cost " + fmtMoney(totalCost)));
  if (havePrices && havePrev) {
    var dayBase = totalVal - dayAmt;
    subrow.appendChild(el("span", {}, "day " + deltaHtml(dayAmt, dayBase ? dayAmt / dayBase : null)));
  }
  if (lifeAmt !== null) {
    subrow.appendChild(el("span", {}, "life " + deltaHtml(lifeAmt, totalCost ? lifeAmt / totalCost : null)));
  }
  pf.appendChild(subrow);
  root.appendChild(pf);

  // ---- delta selector ----
  var seg = el("div", { class: "seg", role: "tablist", "aria-label": "Delta window" });
  ["day", "week", "month", "life"].forEach(function (s) {
    var b = el("button", { type: "button", "aria-current": s === sel ? "true" : "false" }, SEL_LABEL[s]);
    b.addEventListener("click", function () { lsSet("crystal.moneySel", s); renderMoney(""); });
    seg.appendChild(b);
  });
  root.appendChild(seg);

  // ---- dials ----
  var grid = el("div", { class: "dialgrid" });
  var scale = (sel === "day" || sel === "week") ? 0.10 : 0.25;
  positions.forEach(function (p) {
    var q = quotes[p.ticker];
    var val = posValue(p);
    var basis = posBasis(p);
    var dial = el("div", { class: "dial", role: "button", tabindex: "0",
      "data-ticker": p.ticker });
    var gauge = el("div", {}, gaugeSvg(null, scale));
    dial.appendChild(gauge);
    dial.appendChild(el("div", { class: "tk" }, p.ticker + (q && q.stale ? " · stale" : "")));
    dial.appendChild(el("div", { class: "val" }, val !== null ? fmtMoney(val) : "—"));
    dial.appendChild(el("div", { class: "sub" }, "in " + fmtMoney(basis, false)));
    var dline = el("div", { class: "d" }, "");
    dial.appendChild(dline);
    dial.appendChild(el("div", { class: "ltcg" }, ltcgBadge(p)));
    var openDetail = function () { go("#/money/" + p.ticker); };
    dial.addEventListener("click", openDetail);
    dial.addEventListener("keydown", function (e) { if (e.key === "Enter") openDetail(); });
    grid.appendChild(dial);

    var apply = function (pct, amt) {
      gauge.innerHTML = gaugeSvg(pct, scale);
      dline.innerHTML = amt !== null ? deltaHtml(amt, pct) : '<span class="delta">--</span>';
    };
    if (val === null) { apply(null, null); return; }
    if (sel === "life") {
      apply(basis ? (val - basis) / basis : null, val - basis);
    } else if (sel === "day") {
      if (q && typeof q.prevClose === "number" && q.prevClose) {
        var amt = posShares(p) * (q.price - q.prevClose);
        apply((q.price - q.prevClose) / q.prevClose, amt);
      } else apply(null, null);
    } else {
      refPrice(p.ticker, sel === "week" ? "1w" : "1m", function (h) {
        if (h && h.points && h.points.length) {
          var ref = h.points[0].c;
          var amt = posShares(p) * (q.price - ref);
          apply(ref ? (q.price - ref) / ref : null, amt);
        } else apply(null, null);
      });
    }
  });
  root.appendChild(grid);
  root.appendChild(el("div", { class: "gaugehint" },
    "ring full at ±" + Math.round(scale * 100) + "% · " + SEL_LABEL[sel] + " change"));

  // ---- cash earmarks ----
  if (cash.length) {
    var sec = el("div", { class: "cashsec" });
    sec.appendChild(el("div", { class: "eyebrow" }, "cash · earmarked"));
    cash.forEach(function (c) {
      var row = el("div", { class: "cashrow" });
      row.appendChild(el("b", {}, md(c.name)));
      row.appendChild(el("span", { class: "amt" }, fmtMoney(c.amount, false)));
      if (c.earmark) row.appendChild(el("span", { class: "em" }, md(c.earmark)));
      sec.appendChild(row);
    });
    root.appendChild(sec);
  }

  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(function () { loadMoney(true); refreshQuotes(); }));
}

// ---------- money detail ----------
function loadMoneyDetail(ticker) {
  holdings = holdings || lsGet("crystal.holdings", null);
  quotes = Object.keys(quotes).length ? quotes : ((lsGet("crystal.quotes", null) || {}).quotes || {});
  if (!holdings) {
    api("/holdings").then(function (data) {
      holdings = data; lsSet("crystal.holdings", data);
      renderMoneyDetail(ticker); refreshQuotes();
    }).catch(function () { go("#/money"); });
    return;
  }
  renderMoneyDetail(ticker);
  if (!quotes[ticker]) refreshQuotes();
}

function renderMoneyDetail(ticker) {
  var pos = null;
  (holdings && holdings.positions || []).forEach(function (p) { if (p.ticker === ticker) pos = p; });
  if (!pos) { go("#/money"); return; }
  root.innerHTML = "";

  var back = el("button", { type: "button", class: "backbtn" }, "← the ledger");
  back.addEventListener("click", function () { go("#/money"); });
  root.appendChild(back);

  var det = el("div", { class: "det" });
  var q = quotes[ticker];
  var headRow = el("div", { class: "tkhead" });
  headRow.appendChild(el("h2", {}, ticker));
  if (q && q.stale) headRow.appendChild(el("span", { class: "badge gold" }, "stale quote"));
  if (q && q.source === "stooq-delayed") headRow.appendChild(el("span", { class: "badge" }, "delayed"));
  headRow.appendChild(el("span", { class: "px" }, q && typeof q.price === "number" ? fmtMoney(q.price) : "—"));
  det.appendChild(headRow);
  if (q && typeof q.prevClose === "number" && q.prevClose) {
    var dp = (q.price - q.prevClose) / q.prevClose;
    det.appendChild(el("div", { style: "font-family:var(--mono);font-size:.78rem" },
      "today " + deltaHtml(posShares(pos) * (q.price - q.prevClose), dp)));
  }

  // ---- chart ----
  det.appendChild(el("h4", {}, "Price"));
  var range = lsGet("crystal.chartRange", "1m");
  var seg = el("div", { class: "seg", role: "tablist", "aria-label": "Chart range" });
  [["1d", "1D"], ["1w", "1W"], ["1m", "1M"], ["max", "MAX"]].forEach(function (r) {
    var b = el("button", { type: "button", "aria-current": r[0] === range ? "true" : "false" }, r[1]);
    b.addEventListener("click", function () {
      lsSet("crystal.chartRange", r[0]);
      renderMoneyDetail(ticker);
    });
    seg.appendChild(b);
  });
  det.appendChild(seg);
  var chartCard = el("div", { class: "chartcard" },
    '<p class="empty" style="margin:30px 0">loading…</p>');
  det.appendChild(chartCard);
  // the callback may fire synchronously (client cache) before chartCard is in
  // the document, so hold the element itself, never getElementById
  refPrice(ticker, range, function (h) {
    if (!h || !h.points || !h.points.length) {
      chartCard.innerHTML = '<p class="empty" style="margin:26px 0">' +
        (h && h.error ? "Chart unavailable: " + md(h.error) : "No chart data for this range.") + "</p>";
      return;
    }
    drawChart(chartCard, h, range);
  });

  // ---- lots ----
  det.appendChild(el("h4", {}, "Lots"));
  var wrapT = el("div", { class: "tablewrap" });
  var tbl = el("table", { class: "lots" });
  tbl.appendChild(el("thead", {},
    "<tr><th>filled</th><th>shares</th><th>basis</th><th>ltcg</th><th>status</th></tr>"));
  var tb = el("tbody", {});
  pos.lots.forEach(function (l) {
    var d = daysUntil(l.ltcgDate);
    var ltcg = d <= 0 ? '<span class="badge up">✓ LTCG</span>'
      : '<span class="badge">in ' + d + "d</span>";
    var ver = l.verified ? '<span class="badge up">✓ verified</span>'
      : '<span class="badge gold">UNVERIFIED</span>';
    tb.appendChild(el("tr", {},
      "<td>" + l.fillDate + "</td><td>" + l.shares + "</td><td>" + fmtMoney(l.basis, false) +
      "</td><td>" + ltcg + "</td><td>" + ver + "</td>"));
  });
  tbl.appendChild(tb);
  wrapT.appendChild(tbl);
  det.appendChild(wrapT);

  // ---- breakers ----
  if (pos.breakers && pos.breakers.length) {
    det.appendChild(el("h4", {}, "Thesis breakers"));
    pos.breakers.forEach(function (b) {
      var card = el("div", { class: "breaker" });
      card.appendChild(el("div", {}, md(b.text)));
      card.appendChild(el("div", { class: "status" }, "status: " + md(b.status)));
      det.appendChild(card);
    });
  }

  // ---- next event ----
  if (pos.nextEvent && pos.nextEvent.date) {
    det.appendChild(el("h4", {}, "Next event"));
    var ev = el("div", { class: "eventcard" });
    var dd = daysUntil(pos.nextEvent.date);
    ev.appendChild(el("div", { class: "ed" },
      pos.nextEvent.date + (dd >= 0 ? " · in " + dd + "d" : "") + " · " + md(pos.nextEvent.label)));
    if (pos.nextEvent.gate) ev.appendChild(el("div", { class: "gate" }, md(pos.nextEvent.gate)));
    det.appendChild(ev);
  }

  // ---- bound rules ----
  if (pos.rules && pos.rules.length) {
    det.appendChild(el("h4", {}, "Bound council rules"));
    var rl = el("ul", { class: "rulelist" });
    pos.rules.forEach(function (r) { rl.appendChild(el("li", {}, md(r))); });
    det.appendChild(rl);
  }

  // ---- related news ----
  var edition = news || lsGet("crystal.news.last", null);
  var related = ((edition && edition.stories) || []).filter(function (s) {
    return (s.tickerTags || []).indexOf(ticker) >= 0;
  });
  if (related.length) {
    det.appendChild(el("h4", {}, "In the news"));
    related.forEach(function (s) {
      var item = el("div", { class: "newsitem", role: "button", tabindex: "0" });
      item.appendChild(el("div", { class: "cat" }, catLabel(s.cat)));
      item.appendChild(el("div", {}, md(s.headline)));
      item.addEventListener("click", function () { go("#/news/" + encodeURIComponent(s.id)); });
      det.appendChild(item);
    });
  }

  root.appendChild(det);
  root.appendChild(el("p", { class: "moneyfoot" }, "Educational, not advice. Verify on Schwab."));
  root.appendChild(appFooter(function () { refreshQuotes(); renderMoneyDetail(ticker); }));
}

// line chart with a touch crosshair; color follows the range's direction,
// with the signed change printed (never color alone)
function drawChart(container, hist, range) {
  var pts = hist.points;
  var W = 340, H = 150, padL = 6, padR = 6, padT = 12, padB = 18;
  var min = Infinity, max = -Infinity;
  pts.forEach(function (p) { if (p.c < min) min = p.c; if (p.c > max) max = p.c; });
  if (min === max) { min -= 1; max += 1; }
  var X = function (i) { return padL + (i / (pts.length - 1 || 1)) * (W - padL - padR); };
  var Y = function (c) { return padT + (1 - (c - min) / (max - min)) * (H - padT - padB); };
  var up = pts[pts.length - 1].c >= pts[0].c;
  var color = up ? "var(--up)" : "var(--down)";
  var path = pts.map(function (p, i) {
    return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.c).toFixed(1);
  }).join("");
  var area = path + "L" + X(pts.length - 1).toFixed(1) + " " + (H - padB) +
    "L" + padL + " " + (H - padB) + "Z";
  var chg = pts[pts.length - 1].c - pts[0].c;
  var chgPct = pts[0].c ? chg / pts[0].c : 0;

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

  var svg = container.querySelector("#pxchart");
  var chx = container.querySelector("#ch-x");
  var dot = container.querySelector("#ch-dot");
  var tip = container.querySelector("#ch-tip");
  function scrub(clientX) {
    var r = svg.getBoundingClientRect();
    var fx = (clientX - r.left) / r.width * W;
    var i = Math.round((fx - padL) / ((W - padL - padR) / (pts.length - 1 || 1)));
    i = Math.max(0, Math.min(pts.length - 1, i));
    var x = X(i), y = Y(pts[i].c);
    chx.setAttribute("x1", x); chx.setAttribute("x2", x);
    chx.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y);
    dot.setAttribute("visibility", "visible");
    tip.textContent = fmtRangeDate(pts[i].t, range) + "  " + fmtMoney(pts[i].c);
    var anchor = x > W * 0.66 ? "end" : x < W * 0.33 ? "start" : "middle";
    tip.setAttribute("text-anchor", anchor);
    tip.setAttribute("x", x);
    tip.setAttribute("visibility", "visible");
  }
  svg.addEventListener("pointerdown", function (e) { scrub(e.clientX); });
  svg.addEventListener("pointermove", function (e) { if (e.buttons || e.pointerType === "mouse") scrub(e.clientX); });
  svg.addEventListener("pointerleave", function () {
    chx.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.setAttribute("visibility", "hidden");
  });
}

function fmtRangeDate(t, range) {
  var d = new Date(t);
  if (range === "1d") {
    var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "p" : "a";
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + ap;
  }
  if (range === "max") return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------- key screen ----------
function keyScreen(err) {
  tabbar.hidden = true;
  root.innerHTML = "";
  var form = el("div", { id: "keyform" });
  form.appendChild(el("h2", {}, "🔮 Crystal"));
  form.appendChild(el("p", {}, "Paste the access key once. It stays on this phone."));
  var input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "access key";
  form.appendChild(input);
  var msg = el("div", { class: "err" }, err || "");
  var btn = el("button", { type: "button" }, "Unlock");
  btn.addEventListener("click", function () {
    var k = input.value.trim();
    if (!k) { msg.textContent = "Key is empty."; return; }
    localStorage.setItem("crystal.key", k);
    msg.textContent = "Checking...";
    route();
  });
  form.appendChild(btn);
  form.appendChild(msg);
  root.appendChild(form);
  input.focus();
}

// ---------- boot ----------
if (!location.hash) history.replaceState(null, "", "#/today");
route();
