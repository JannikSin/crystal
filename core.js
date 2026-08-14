// core.js: the floor every tab stands on. Storage, markdown, dates, the API
// client, the key screen, and the small DOM helpers. No tab logic lives here
// and nothing here knows which tab is on screen.

export const WORKER = "https://crystal-brief.janniksin.workers.dev";
export const HISTORY_DAYS = 8; // today + 7 back in the day switchers
export const root = document.getElementById("root");
export const tabbar = document.getElementById("tabbar");

// ---------- storage ----------
export function lsGet(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
// Returns false when the write did not land (a full quota on iOS throws here),
// so a caller that promised the user something is saved can say otherwise.
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
}
export function lsDel(k) {
  try { localStorage.removeItem(k); } catch (e) {}
}

// Dated caches, keyed <prefix><YYYY-MM-DD>. Nothing older than the day
// switchers can reach is reachable, so it is only quota being burned.
const DATED = ["brief.day.", "brief.ticks.", "brief.caps.", "crystal.read.",
  "crystal.reveal.", "crystal.newsbatch.", "crystal.markets."];

export function pruneDated() {
  const cut = new Date();
  cut.setDate(cut.getDate() - (HISTORY_DAYS + 1));
  const cutIso = isoOf(cut);
  const oldest = Date.now() - (HISTORY_DAYS + 1) * 86400000;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      const p = DATED.find((x) => k.indexOf(x) === 0);
      if (p) { if (k.slice(p.length) < cutIso) lsDel(k); continue; }
      // the quote-history cache is stamped, not dated
      if (k.indexOf("crystal.qh.") === 0) {
        const at = (lsGet(k, null) || {}).at;
        if (typeof at !== "number" || at < oldest) lsDel(k);
      }
    }
  } catch (e) {}
}

// Every cached server payload, and nothing the user is still owed: the queue,
// the local tick state and the upload store all survive. Used when the key
// changes, because a payload fetched with the old key is not this key's data.
const PAYLOADS = ["brief.last", "brief.day.", "crystal.news.last", "crystal.markets.",
  "crystal.career", "crystal.listen", "crystal.holdings", "crystal.quotes", "crystal.qh.",
  // the shop list. The CART (crystal.cart) is deliberately not here: it is the
  // user's own taps, not a payload fetched with a key.
  "crystal.shopping",
  // the library is the biggest payload of all and was missing here, so changing
  // the key left the OLD key's whole vault on the phone and its ~1 MB unreclaimable
  "crystal.library"];

export function clearPayloads() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && PAYLOADS.some((p) => k.indexOf(p) === 0)) lsDel(k);
    }
  } catch (e) {}
}
// One key, one name. The old brief.key fallback is gone with the /brief app.
export function key() { return localStorage.getItem("crystal.key") || ""; }

// ---------- inline markdown ----------
// Properties this relies on, in order, because every string the Worker returns
// goes through here:
//   1. ESCAPE FIRST. &, < and > are replaced before any tag is introduced, so
//      no payload text can ever open a tag of its own.
//   2. The tags produced below are a fixed, closed set (strong, em, del, code,
//      a, span). Payload text only ever lands in TEXT positions of those tags.
//   3. The one attribute position is the href, and the URL pattern excludes
//      quotes, backticks, whitespace and angle brackets, so a crafted "link"
//      cannot close the attribute or add another one.
// Change any of the three and this stops being safe.
export function md(s) {
  s = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Emphasis only where a * actually flanks a word, never mid-token. The old
  // rule matched INSIDE identifiers, so an engineering note reading
  // "sigma ~ E*alpha*deltaT" rendered as "sigma ~ E alpha deltaT": both
  // multiplication operators eaten, silently, with the result still looking
  // like a sentence. Same hazard in "1.4*lambda" and "0.5*UTS(T)".
  s = s.replace(/(^|[^\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, "$1<em>$2</em>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // \u0001-\u0003 are excluded because library.js stashes wikilinks behind those
  // sentinels and restores them AFTER this runs. A [[link]] written inside a URL
  // otherwise survives into the href and the restore splices generated markup
  // into an attribute position. No escape is possible from there today (the id
  // it builds is bounded by ID_RE, alnum and hyphen only), but that bound is the
  // only thing holding it, so keep the sentinels out of URLs.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"'<>`\u0001-\u0003]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[^"=>])\b(https?:\/\/[^\s<)\]"'`\u0001-\u0003]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  s = s.replace(/«([^»]+)»/g, '<span class="wiki">$1</span>');
  return s;
}

// block markdown: bullets, headings, paragraphs. Every line goes through md().
export function blockMd(container, text) {
  const lines = String(text || "").split(/\r?\n/);
  let ul = null;
  lines.forEach((line) => {
    const t = line.trim();
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
  return container;
}

// ---------- dates + formats ----------
const p2 = (n) => (n < 10 ? "0" : "") + n;
export function isoOf(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
export function todayIso() { return isoOf(new Date()); }
export function shiftIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoOf(d);
}
// Carries the offset, so a stamp made in Antibes still compares correctly
// against one made in West Lafayette.
export function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return isoOf(d) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) +
    (off < 0 ? "-" : "+") + p2(Math.floor(a / 60)) + ":" + p2(a % 60);
}
export function fmtBuilt(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  let h = d.getHours();
  const m = d.getMinutes(), ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return "built " + h + ":" + p2(m) + " " + ap;
}
export function fmtDay(iso) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
export function fmtWeekday(iso) {
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
export function fmtMoney(v, cents) {
  if (typeof v !== "number" || !isFinite(v)) return "--";
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: cents === false ? 0 : 2,
    maximumFractionDigits: cents === false ? 0 : 2,
  });
}
export function fmtPct(p) {
  if (typeof p !== "number" || !isFinite(p)) return "--";
  return (p >= 0 ? "+" : "") + (p * 100).toFixed(2) + "%";
}
export const arrowOf = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "•");
export const dirClass = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
export function daysUntil(iso) {
  return Math.ceil((new Date(iso + "T00:00:00") - new Date()) / 86400000);
}

// ---------- dom ----------
export function el(tag, attrs, html) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (html !== undefined) e.innerHTML = html;
  return e;
}
export const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>';

// ---------- api ----------
export function api(path) {
  return fetch(WORKER + path, { headers: { "x-brief-key": key() } }).then((r) => {
    if (r.status === 401) { keyScreen("That key was refused."); throw "auth"; }
    if (r.status === 404) throw "empty";
    if (!r.ok) throw "http " + r.status;
    return r.json();
  });
}

// One loader for every tab that is "cached copy first, network second".
// render(data, note, empty) is called once or twice: immediately from cache,
// then again when the network answers.
export function loadCached(path, cacheKey, render, force) {
  const cached = lsGet(cacheKey, null);
  if (cached && !force) render(cached, "");
  return api(path)
    .then((data) => { lsSet(cacheKey, data); render(data, ""); return data; })
    .catch((e) => {
      if (e === "auth") return null;
      if (e === "empty") { render(null, "", true); return null; }
      if (cached) render(cached, "Offline. Showing the cached copy.");
      else render(null, "Needs signal to fetch this.", true);
      return null;
    });
}

// ---------- routing hook ----------
// app.js owns the router; core only needs to be able to re-enter it after the
// key screen. Set once at boot.
let router = () => {};
export function setRouter(fn) { router = fn; }
// Assigning the hash it already has fires no hashchange, so the tap does
// nothing at all. That is the "I can see today but I cannot click it" bug:
// on Markets the day row highlights the DIGEST's date, so tapping today when
// today is already the route was a dead button. Re-enter the router by hand.
// The safety of this rests on an invariant nothing else enforces: the fallback
// hash a not-found sub-route jumps to always has FEWER segments than the hash
// that reached it, so it cannot bounce back. The latch makes that a guarantee
// instead of a convention, because the failure mode is an unbounded synchronous
// recursion after root.innerHTML has already been cleared, i.e. a white screen
// on a phone with nothing in the console.
let inRouter = false;
export function go(hash) {
  if (location.hash === hash) {
    if (inRouter) return;
    inRouter = true;
    try { router(); } finally { inRouter = false; }
    return;
  }
  location.hash = hash;
}

// Every tab fetches on its own clock, so a slow answer can land after the user
// has walked to another tab. Renderers check this first and drop the paint.
export function isTab(name) {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0];
  return (h || "today") === name;
}

// ---------- shared furniture ----------
export function mastHead(section, title, sub) {
  const head = el("header", {});
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · " + section));
  head.appendChild(el("h1", {}, title));
  if (sub) head.appendChild(el("div", { class: "strap" }, sub));
  return head;
}

export function appFooter(refreshFn) {
  const f = el("footer", { class: "app" });
  f.appendChild(el("div", {}, "Captured. You do not carry it."));
  const btns = el("div", { class: "btns" });
  const re = el("button", { type: "button" }, "Refresh");
  re.addEventListener("click", refreshFn);
  const ck = el("button", { type: "button" }, "Change key");
  // a payload fetched with the old key must not survive into the new one
  ck.addEventListener("click", () => { clearPayloads(); keyScreen(""); });
  const fg = el("button", { type: "button", class: "danger" }, "Forget this phone");
  fg.addEventListener("click", () => {
    if (confirm("Wipe the key, every cached payload and every pending recording from this phone?")) forgetPhone();
  });
  btns.appendChild(re);
  btns.appendChild(ck);
  btns.appendChild(fg);
  f.appendChild(btns);
  return f;
}

export function emptyState(glyph, title, text) {
  const d = el("div", { class: "emptybig" });
  d.appendChild(el("div", { class: "glyph" }, glyph));
  d.appendChild(el("h3", {}, title));
  d.appendChild(el("p", {}, text));
  return d;
}

export function renderDays(current, onPick) {
  const row = el("div", { class: "days", role: "tablist", "aria-label": "Day" });
  for (let back = 0; back < HISTORY_DAYS; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const iso = isoOf(d);
    const b = el("button", { type: "button", "aria-current": iso === current ? "true" : "false" },
      '<span class="dw">' + (back === 0 ? "today" : d.toLocaleDateString("en-US", { weekday: "short" })) +
      '</span><span class="dn">' + d.getDate() + "</span>");
    b.addEventListener("click", () => onPick(back === 0 ? "" : iso, iso));
    row.appendChild(b);
  }
  return row;
}

// ---------- key screen ----------
export function keyScreen(err) {
  tabbar.hidden = true;
  root.innerHTML = "";
  const form = el("div", { id: "keyform" });
  form.appendChild(el("h2", {}, "🔮 Crystal"));
  form.appendChild(el("p", {}, "Paste the access key once. It stays on this phone."));
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "access key";
  form.appendChild(input);
  const msg = el("div", { class: "err" }, err || "");
  const btn = el("button", { type: "button" }, "Unlock");
  btn.addEventListener("click", () => {
    const k = input.value.trim();
    if (!k) { msg.textContent = "Key is empty."; return; }
    localStorage.setItem("crystal.key", k);
    msg.textContent = "Checking...";
    router();
  });
  form.appendChild(btn);
  form.appendChild(msg);
  root.appendChild(form);
  input.focus();
}

// ---------- forget this phone ----------
// Everything this app ever wrote: the key, every crystal.*/brief.* value, the
// upload blob store, and the offline shell caches. Then back to the key screen.
export function forgetPhone() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.indexOf("crystal.") === 0 || k.indexOf("brief.") === 0)) localStorage.removeItem(k);
    }
  } catch (e) {}
  try { indexedDB.deleteDatabase("crystal"); } catch (e) {}
  if (window.caches) {
    // Own prefix ONLY. The sibling PWAs (brief, bonmot, grandstand, tally,
    // finesse) share janniksin.github.io, so a blanket sweep here evicts their
    // offline shells too and they will not open without signal. sw.js:62 filters
    // correctly; this call did not, and forgetting one phone quietly broke five
    // apps on the train. Found by council review 2026-08-13.
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("crystal-")).map((k) => caches.delete(k))))
      .catch(() => {});
  }
  setTimeout(() => location.reload(), 250);
}
