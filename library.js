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

import {
  root, api, el, md, lsGet, lsSet, go, mastHead, appFooter, emptyState, isTab,
} from "./core.js";

let library = null;

export function open(parts) {
  library = library || lsGet("crystal.library", null);
  if (parts && parts[1]) { loadNote(parts[1]); return; }
  load(false);
}

function load(force) {
  library = lsGet("crystal.library", null);
  if (library && !force) renderIndex("");
  api("/library")
    .then((data) => { library = data; lsSet("crystal.library", data); renderIndex(""); })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { renderIndex("", true); return; }
      if (library) renderIndex("Offline. Showing the cached vault.");
      else renderIndex("", true);
    });
}

const notes = () => (library && library.notes) || [];

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

function inline(s) {
  // stash wikilinks before escaping, restore after, so the label gets escaped
  // by md() and the href is rebuilt from a resolved id rather than from text.
  // The sentinels are stripped from the input first, so a note body cannot
  // smuggle one in and forge a link marker.
  const clean = String(s).replace(/[\u0001\u0002\u0003]/g, "");
  const stashed = clean.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (m, tgt, lab) => W1 + tgt + W2 + (lab || tgt) + W3);
  let out = md(stashed);
  out = out.replace(new RegExp(W1 + "([^" + W2 + "]*)" + W2 + "([^" + W3 + "]*)" + W3, "g"),
    (m, tgt, lab) => {
      const hit = resolve(tgt);
      if (!hit) return '<span class="wiki">' + lab + "</span>";
      return '<a class="wikilink" href="#/library/' + hit.id + '">' + lab + "</a>";
    });
  return out;
}

const ALIGN = (c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "");

function renderBlocks(src) {
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
      inner += renderBlocks(buf.join("\n")) + "</div>";
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
  root.innerHTML = "";
  const sub = library ? notes().length + " notes · " + String(library.date).slice(0, 10) : "";
  root.appendChild(mastHead("library", "The Library", sub));
  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (noLibrary || !library) {
    root.appendChild(emptyState("📚", "No notes yet",
      "Run push_library.py on the laptop and the vault appears here."));
    root.appendChild(appFooter(() => load(true)));
    return;
  }

  const q = el("input", {
    class: "libsearch", type: "search", placeholder: "Filter notes…",
    "aria-label": "Filter notes", autocapitalize: "none", autocorrect: "off",
  });
  root.appendChild(q);

  const listWrap = el("div", { class: "libtree" });
  root.appendChild(listWrap);

  const draw = (filter) => {
    listWrap.innerHTML = "";
    const f = filter.trim().toLowerCase();
    const hits = notes().filter((n) => !f ||
      (n.title + " " + (n.summary || "") + " " + n.folder + " " + n.body).toLowerCase().indexOf(f) >= 0);
    if (!hits.length) {
      listWrap.appendChild(el("p", { class: "empty" }, "Nothing matches that."));
      return;
    }
    const folders = [];
    hits.forEach((n) => { if (folders.indexOf(n.folder) < 0) folders.push(n.folder); });
    folders.forEach((folder) => {
      const sec = el("section", { class: "libfolder" });
      sec.appendChild(el("div", { class: "eyebrow" }, md(folder || "vault root")));
      hits.filter((n) => n.folder === folder).forEach((n) => {
        const row = el("button", { type: "button", class: "librow" });
        row.appendChild(el("div", { class: "lt" }, md(n.title)));
        if (n.summary) row.appendChild(el("div", { class: "ls" }, md(n.summary)));
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
  draw(lsGet("crystal.libFilter", ""));
  q.value = lsGet("crystal.libFilter", "");
  q.addEventListener("input", () => { lsSet("crystal.libFilter", q.value); draw(q.value); });

  root.appendChild(el("p", { class: "moneyfoot" },
    "Written on the laptop into Obsidian, read here. Editing still happens in the vault."));
  root.appendChild(appFooter(() => load(true)));
}

// ---------- reader ----------
function loadNote(id) {
  library = library || lsGet("crystal.library", null);
  if (!library) {
    api("/library").then((data) => {
      library = data; lsSet("crystal.library", data); renderNote(id);
    }).catch(() => go("#/library"));
    return;
  }
  renderNote(id);
}

function renderNote(id) {
  const n = notes().find((x) => x.id === id);
  if (!n) { go("#/library"); return; }
  if (!isTab("library")) return;
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
