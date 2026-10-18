// library.js: LIBRARY, "the vault, on the phone".
//
// David's problem was navigation, not storage: the write-ups live in Obsidian
// and he could never find them. So the notes themselves ride down with the
// rest of the payloads and render here, offline, in the same digestible shape
// as the other tabs. Obsidian stays the place they are written and searched on
// a laptop; this is the place they are READ.
//
// Three views, one module: the folder index, a filter, and the note reader.
// Wikilinks between notes resolve INSIDE the app, so following a thought never
// bounces you out to a file picker.
//
// "The vault" is now THREE vaults: Crystal (the assistant), PURPL (engineering,
// the papers) and Abroad (the travel channel). This module is deliberately
// vault-agnostic, so nothing here needs to know which is which, but be aware
// that a note's `uri` can point at any of the three, not just Crystal. The
// folder label is the only thing that carries the distinction.

import {
  root, api, el, md, lsGet, lsSet, lsDel, idbGet, idbSet, go, mastHead, appFooter,
  emptyState, isTab, todayIso,
} from "./core.js";
import { filesCard } from "./files.js";

let library = null;
// Session state, deliberately NOT localStorage. A search string that outlives
// the app launch is a trap: open the tab tomorrow for a Money note, land on
// yesterday's text plus a sticky folder chip, and the tab reads "Nothing
// matches that" with no visible cause. Module scope keeps it across a
// note-and-back trip and drops it when the app is closed, which is what the
// filter actually means. The folder chip DOES persist; it is visible.
let libFilter = "";

export function open(parts) {
  if (parts && parts[1]) { loadNote(parts[1]); return; }
  load(false);
}

// The saved vault, wherever it lives. The library moved from localStorage to
// IndexedDB on 2026-08-29 (session hugoniot): localStorage is ~5 MB per origin
// in UTF-16 and shared with five sibling PWAs, and this payload alone had
// outgrown it, so every push past ~2 MB silently stopped saving for offline.
// IndexedDB's quota is hundreds of MB and the ceiling is gone.
// A phone that saved the vault before the move still holds it under the old
// localStorage key: use it once, copy it into IndexedDB, and delete the old
// copy, which hands ~4.6 MB of shared-origin quota back to the other apps.
function cachedLibrary() {
  if (library) return Promise.resolve(library);
  return idbGet("crystal.library", null).then((v) => {
    if (v) { lsDel("crystal.library"); return v; }
    const old = lsGet("crystal.library", null);
    if (old) idbSet("crystal.library", old).then((ok) => { if (ok) lsDel("crystal.library"); });
    return old;
  });
}

function load(force) {
  cachedLibrary().then((cached) => {
    library = cached;
    if (library && !force) renderIndex("");
    api("/library")
      .then((data) => {
        library = data;
        renderIndex("");
        paintBadge();
        // A refused write means no offline reading, which is the whole point
        // of this tab, so it is said out loud. With IndexedDB it should take
        // private browsing or a full disk, not a big vault, but the promise is
        // the same: say which of the two states the phone is actually in,
        // because "nothing saved" and "an older copy is still there" are very
        // different things to discover in a basement with no signal. A failed
        // put leaves the previous copy intact.
        idbSet("crystal.library", data).then((saved) => {
          if (!saved) renderIndex(cached
            ? "Could not save the update on this phone. You are seeing the current notes now, but offline you will get the older saved copy."
            : "Could not save on this phone. The notes are here now, but nothing is saved for offline.");
        });
      })
      .catch((e) => {
        if (e === "auth") return;
        if (e === "empty") { renderIndex("", true); return; }
        if (library) renderIndex("Offline. Showing the cached vault.");
        else renderIndex("", true);
      });
  });
}

const notes = () => (library && library.notes) || [];

// ---------- for you ----------
// David, 2026-10-18: "I never open this tab and I never really look at things. So how can we change that and
// how should I be using this?" The index opened on two dozen worker session notes titled by codeword, written
// for the sessions, not for him. So it now opens on what is NEW and written for him: at most five notes
// from his own folders that arrived on this phone in the last week and that he has not opened, each with
// its one-line summary. The Library tab carries the count, so he can see from any tab when there is
// something to read.
// "Arrived", not "updated": the boards (Tasks, Dashboard, Stock Research) are rewritten every hour, and
// tested against the live vault an "updated this week" rule put 62 notes and 9+ on the tab. A note's first
// appearance is what marks a new write-up, so the phone remembers the day it first saw each id. The first
// run baselines everything already there, so only what lands afterwards counts.
const NOT_FOR_YOU = ["Sessions", "System", "Lanes"];
const SEEN_KEY = "crystal.libSeen";   // {"<id>": 1}: opened on this phone
const KNOWN_KEY = "crystal.libKnown"; // {"<id>": "YYYY-MM-DD"}: the day this phone first saw it ("" = baseline)
const FRESH_DAYS = 7;

// The day each note first appeared, filled in place. Exported, with forYou, for tools/test_library_foryou.mjs.
export function learn(all, known, today) {
  const first = !Object.keys(known).length;
  all.forEach((n) => { if (!(n.id in known)) known[n.id] = first ? "" : today; });
  return known;
}

export function forYou(all, seen, known, today) {
  const cut = new Date(today.getTime() - FRESH_DAYS * 864e5).toISOString().slice(0, 10);
  return all
    .filter((n) => NOT_FOR_YOU.indexOf(n.folder) < 0 && known[n.id] && known[n.id] >= cut && !seen[n.id])
    .sort((a, b) => String(known[b.id]).localeCompare(String(known[a.id])) ||
      String(b.updated || "").localeCompare(String(a.updated || "")));
}

const seenMap = () => lsGet(SEEN_KEY, {}) || {};
function knownMap(all) {
  const known = learn(all, lsGet(KNOWN_KEY, {}) || {}, todayIso());
  lsSet(KNOWN_KEY, known);
  return known;
}
const fresh = (all) => forYou(all, seenMap(), knownMap(all), new Date());

// the count on the Library tab button, from the saved vault, so it shows offline and from any tab
export function paintBadge() {
  cachedLibrary().then((lib) => {
    const btn = document.querySelector('#tabbar button[data-tab="library"]');
    if (!btn) return;
    const n = lib ? fresh(lib.notes || []).length : 0;
    let dot = btn.querySelector(".tabdot");
    if (!n) { if (dot) dot.remove(); return; }
    if (!dot) { dot = el("span", { class: "tabdot", "aria-label": "new to read" }); btn.appendChild(dot); }
    dot.textContent = n > 9 ? "9+" : String(n);
  }).catch(() => {});
}

// ---------- id resolution ----------
// The pusher slugifies the vault-relative path; this repeats the rule so a
// [[wikilink]] written in Obsidian can find its target here. Basenames are
// indexed too, because the vault writes both [[Money/Desk]] and [[Desk]].
export function slugify(s) {
  return String(s).toLowerCase().replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function resolve(target) {
  const t = String(target).split("#")[0].trim();
  if (!t) return null;
  const want = slugify(t);
  const all = notes();
  let hit = all.find((n) => n.id === want);
  if (hit) return hit;
  const base = slugify(t.split("/").pop());
  hit = all.find((n) => slugify(String(n.title)) === base);
  if (hit) return hit;
  return all.find((n) => n.id.endsWith("-" + base) || n.id === base) || null;
}

// ---------- block markdown ----------
// core.js md() handles inline and, critically, escapes the payload first. This
// only ever wraps the ALREADY-escaped output in a fixed set of block tags, and
// the one href it produces is an in-app hash built from a slug that was matched
// against a known note id. No payload text ever reaches an attribute position.
const W1 = "\u0001", W2 = "\u0002", W3 = "\u0003";

// David cannot read raw LaTeX or plain-text math; that is an absolute rule, not
// a preference. This renderer has no math engine, so $...$ and $$...$$ would
// land on his phone as a literal \frac{k_{wall}}{\sqrt{\pi \alpha_{wall}}}.
// Rather than show him that, the equation is REMOVED and replaced with a
// pointer: every note already carries an obsidian:// uri and Obsidian renders
// MathJax natively. The replacement is a CONSTANT, so no payload text ever
// reaches markup. Only DELIMITED math is detectable this way; several PURPL
// papers also carry undelimited plain-text notation, which is a source-content
// problem in those notes, not something a renderer can find.
const MATH = "\u0004";
const MATH_CHIP = '<span class="matheq">equation, open in Obsidian</span>';
const stripMath = (t) => String(t).replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, MATH);

function inline(s) {
  // stash wikilinks before escaping, restore after, so the label gets escaped
  // by md() and the href is rebuilt from a resolved id rather than from text.
  // The sentinels are stripped from the input first, so a note body cannot
  // smuggle one in and forge a link marker.
  const clean = stripMath(String(s).replace(/[\u0001\u0002\u0003\u0004]/g, ""));
  const stashed = clean.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (m, tgt, lab) => W1 + tgt + W2 + (lab || tgt) + W3);
  let out = md(stashed);
  out = out.replace(new RegExp(W1 + "([^" + W2 + "]*)" + W2 + "([^" + W3 + "]*)" + W3, "g"),
    (m, tgt, lab) => {
      const hit = resolve(tgt);
      // .wiki-dead, never .wiki: .wiki is the shared guillemet pill in the base
      // stylesheet that core.js md() emits on every tab.
      if (!hit) return '<span class="wiki-dead">' + lab + "</span>";
      return '<a class="wikilink" href="#/library/' + hit.id + '">' + lab + "</a>";
    });
  return out.split(MATH).join(MATH_CHIP);
}

const ALIGN = (c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "");

// depth caps the blockquote recursion. A pasted email quote chain is thousands
// of ">" levels deep and would blow the stack, which renders the tab empty with
// nothing in the console to say why.
function renderBlocks(src, depth) {
  depth = depth || 0;
  const lines = String(src).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code: verbatim, escaped, never inline-parsed
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push("<pre><code>" + buf.join("\n")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code></pre>");
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = Math.min(6, h[1].length + 1); // note h1 becomes h2 under the masthead
      out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">");
      i++;
      continue;
    }

    // table: a header row followed by a |---|---| separator
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map(ALIGN);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      let h2 = "<thead><tr>";
      head.forEach((c, n) => {
        h2 += "<th" + (aligns[n] ? ' style="text-align:' + aligns[n] + '"' : "") + ">" + inline(c) + "</th>";
      });
      h2 += "</tr></thead><tbody>";
      body.forEach((r) => {
        h2 += "<tr>";
        r.forEach((c, n) => {
          h2 += "<td" + (aligns[n] ? ' style="text-align:' + aligns[n] + '"' : "") + ">" + inline(c) + "</td>";
        });
        h2 += "</tr>";
      });
      out.push('<div class="tablewrap"><table class="vtable">' + h2 + "</tbody></table></div>");
      continue;
    }

    // blockquote, including Obsidian callouts (> [!warning] Title)
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      let kind = "", title = "";
      const cal = buf[0] && buf[0].match(/^\[!(\w+)\]\s*(.*)$/);
      if (cal) { kind = cal[1].toLowerCase(); title = cal[2]; buf.shift(); }
      let inner = '<div class="callout ' + (/^[a-z]+$/.test(kind) ? kind : "") + '">';
      if (title) inner += '<div class="ct">' + inline(title) + "</div>";
      inner += (depth >= 8
        ? "<p>" + inline(buf.join(" ")) + "</p>"
        : renderBlocks(buf.join("\n"), depth + 1)) + "</div>";
      out.push(inner);
      continue;
    }

    // lists, including checkboxes and one level of nesting
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      let baseIndent = null;
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const ind = (lines[i].match(/^\s*/) || [""])[0].length;
        if (baseIndent === null) baseIndent = ind;
        if (ind < baseIndent) break;
        let text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        let box = "";
        const cb = text.match(/^\[([ xX/])\]\s*(.*)$/);
        if (cb) {
          const m2 = cb[1].toLowerCase();
          box = '<span class="tick ' + (m2 === "x" ? "done" : m2 === "/" ? "wip" : "") + '">' +
            (m2 === "x" ? "✓" : m2 === "/" ? "◐" : "○") + "</span> ";
          text = cb[2];
        }
        items.push({ ind: ind, html: box + inline(text) });
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      let html = "<" + tag + ">";
      let open = false;
      items.forEach((it) => {
        if (it.ind > baseIndent) {
          if (!open) { html += "<" + tag + ">"; open = true; }
        } else if (open) { html += "</" + tag + ">"; open = false; }
        html += "<li>" + it.html + "</li>";
      });
      if (open) html += "</" + tag + ">";
      out.push(html + "</" + tag + ">");
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // paragraph: consume until a blank line or the start of another block
    const buf = [];
    while (i < lines.length && lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|```|\||[-*+]\s|\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push("<p>" + inline(buf.join(" ")) + "</p>");
    else i++;
  }
  return out.join("");
}

// ---------- index ----------
function renderIndex(note, noLibrary) {
  if (!isTab("library")) return;
  // Refresh on a NOTE page calls load(true), whose .then lands here a moment
  // later and would paint the index over the note the user is reading.
  // news.js guards the same hazard the same way.
  if (/#\/library\/./.test(location.hash)) return;
  root.innerHTML = "";
  const sub = library ? notes().length + " notes · " + String(library.date).slice(0, 10) : "";
  root.appendChild(mastHead("library", "The Library", sub));
  if (note) root.appendChild(el("div", { class: "banner" }, note));
  // Files first: a PDF made for him today is the thing he opened the tab for
  // (standby, 2026-10-10). It hides itself when there are none.
  root.appendChild(filesCard());

  if (noLibrary || !library) {
    root.appendChild(emptyState("📚", "No notes yet",
      "Run push_library.py on the laptop and the vault appears here."));
    root.appendChild(appFooter(() => load(true)));
    return;
  }

  // For you: what is new and written for him, ahead of everything else
  const news = fresh(notes());
  const fy = el("section", { class: "foryou" });
  fy.appendChild(el("div", { class: "eyebrow" }, "for you"));
  if (!news.length) {
    fy.appendChild(el("p", { class: "empty" }, "Nothing new since you last looked. Everything else is below."));
  }
  news.slice(0, 5).forEach((n) => {
    const row = el("button", { type: "button", class: "librow fyrow" });
    const t = el("div", { class: "lt" });
    t.appendChild(el("span", { class: "fydot", "aria-label": "unread" }));
    t.appendChild(el("span", {}, md(n.title)));
    row.appendChild(t);
    // a summary of bare frontmatter dashes ("---", seen on Stock Research) says nothing: leave it off
    if (n.summary && /\w/.test(n.summary)) row.appendChild(el("div", { class: "ls" }, md(n.summary)));
    row.appendChild(el("div", { class: "lm" }, md(n.folder + " · updated " + String(n.updated).slice(0, 10) + " · " +
      Math.max(1, Math.round(n.body.length / 1100)) + " min")));
    row.addEventListener("click", () => go("#/library/" + n.id));
    fy.appendChild(row);
  });
  if (news.length > 5) fy.appendChild(el("p", { class: "lm" }, (news.length - 5) + " more new below."));
  root.appendChild(fy);

  // Folder chips. With 48 notes the index is longer than a phone screen, so
  // "where are the papers" was a scroll hunt. One tap now answers it.
  const allFolders = [];
  notes().forEach((n) => { if (allFolders.indexOf(n.folder) < 0) allFolders.push(n.folder); });
  // The two David actually goes looking for lead, because the chip row scrolls
  // horizontally and anything past the fourth chip is off the right edge of an
  // iPhone. Reading ORDER inside the list is still the pusher's; this is only
  // which shortcuts are reachable without a swipe.
  ["Papers", "Money"].forEach((f) => {
    const i = allFolders.indexOf(f);
    if (i > 0) allFolders.unshift(allFolders.splice(i, 1)[0]);
  });
  let picked = lsGet("crystal.libFolder", "");
  if (picked && allFolders.indexOf(picked) < 0) picked = "";
  const chips = el("div", { class: "libchips", role: "tablist", "aria-label": "Folder" });
  root.appendChild(chips);

  const q = el("input", {
    class: "libsearch", type: "search", placeholder: "Filter notes…",
    "aria-label": "Filter notes", autocapitalize: "none", autocorrect: "off",
  });
  root.appendChild(q);

  const listWrap = el("div", { class: "libtree" });
  root.appendChild(listWrap);

  const drawChips = () => {
    chips.innerHTML = "";
    [""].concat(allFolders).forEach((f) => {
      const b = el("button", { type: "button", class: "libchip", "aria-current": f === picked ? "true" : "false" },
        md(f || "All"));
      b.addEventListener("click", () => {
        picked = picked === f ? "" : f;
        lsSet("crystal.libFolder", picked);
        drawChips();
        draw(q.value);
      });
      chips.appendChild(b);
    });
  };

  const draw = (filter) => {
    listWrap.innerHTML = "";
    const f = filter.trim().toLowerCase();
    const hits = notes().filter((n) => (!picked || n.folder === picked) && (!f ||
      (n.title + " " + (n.summary || "") + " " + n.folder + " " + n.body).toLowerCase().indexOf(f) >= 0));
    if (!hits.length) {
      listWrap.appendChild(el("p", { class: "empty" },
        picked ? "Nothing matches that in " + md(picked) + "." : "Nothing matches that."));
      const clear = el("button", { type: "button", class: "findmore" }, "Clear filters");
      clear.addEventListener("click", () => {
        picked = ""; libFilter = ""; q.value = "";
        lsSet("crystal.libFolder", "");
        drawChips(); draw("");
      });
      listWrap.appendChild(clear);
      return;
    }
    const folders = [];
    hits.forEach((n) => { if (folders.indexOf(n.folder) < 0) folders.push(n.folder); });
    // session notes go last: they are the sessions' records, and they used to be the first screen
    if (folders.indexOf("Sessions") >= 0) folders.push(folders.splice(folders.indexOf("Sessions"), 1)[0]);
    folders.forEach((folder) => {
      const sec = el("section", { class: "libfolder" });
      sec.appendChild(el("div", { class: "eyebrow" }, md(folder || "vault root")));
      hits.filter((n) => n.folder === folder).forEach((n) => {
        const row = el("button", { type: "button", class: "librow" });
        // a session note leads with what the session did; its codeword title is the small print
        const sess = folder === "Sessions" && n.summary;
        row.appendChild(el("div", { class: "lt" }, md(sess ? n.summary : n.title)));
        if (sess) row.appendChild(el("div", { class: "ls" }, md(n.title)));
        else if (n.summary) row.appendChild(el("div", { class: "ls" }, md(n.summary)));
        const meta = [];
        if (n.updated) meta.push("updated " + String(n.updated).slice(0, 10));
        meta.push(Math.max(1, Math.round(n.body.length / 1100)) + " min");
        row.appendChild(el("div", { class: "lm" }, md(meta.join(" · "))));
        row.addEventListener("click", () => go("#/library/" + n.id));
        sec.appendChild(row);
      });
      listWrap.appendChild(sec);
    });
  };
  drawChips();
  draw(libFilter);
  q.value = libFilter;
  q.addEventListener("input", () => { libFilter = q.value; draw(q.value); });

  root.appendChild(el("p", { class: "moneyfoot" },
    "Written on the laptop into Obsidian, read here. Editing still happens in the vault."));
  root.appendChild(appFooter(() => load(true)));
}

// ---------- reader ----------
function loadNote(id) {
  cachedLibrary().then((cached) => {
    library = cached;
    if (!library) {
      api("/library").then((data) => {
        library = data; idbSet("crystal.library", data); renderNote(id);
      }).catch(() => go("#/library"));
      return;
    }
    renderNote(id);
  });
}

function renderNote(id) {
  const n = notes().find((x) => x.id === id);
  if (!n) { go("#/library"); return; }
  if (!isTab("library")) return;
  // opened = read, for "for you" and the tab count
  const seen = seenMap();
  if (!seen[n.id]) { seen[n.id] = 1; lsSet(SEEN_KEY, seen); paintBadge(); }
  root.innerHTML = "";

  const back = el("button", { type: "button", class: "backbtn" }, "← the library");
  back.addEventListener("click", () => go("#/library"));
  root.appendChild(back);

  const det = el("article", { class: "note" });
  det.appendChild(el("div", { class: "eyebrow" }, md(n.folder || "vault root")));
  det.appendChild(el("h2", {}, md(n.title)));
  if (n.updated) det.appendChild(el("div", { class: "nmeta" }, "updated " + md(String(n.updated).slice(0, 10))));
  const body = el("div", { class: "notebody" });
  body.innerHTML = renderBlocks(n.body);
  det.appendChild(body);

  // href is an attribute position, so the scheme is checked here rather than
  // trusted from the payload: obsidian:// and https:// only, and no quotes,
  // whitespace or angle brackets. A malformed uri simply renders no button.
  if (n.uri && /^(obsidian:\/\/|https:\/\/)[^\s"'<>`]+$/.test(n.uri)) {
    det.appendChild(el("a", { class: "obsidian", href: n.uri }, "Open in Obsidian to edit"));
  }
  root.appendChild(det);
  root.appendChild(appFooter(() => { load(true); renderNote(id); }));
}
