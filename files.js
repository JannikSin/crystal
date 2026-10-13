// files.js: the Files shelf at the top of LIBRARY.
//
// David, 2026-10-10 (standby): ntfy attachments expire in hours and the Drive
// folder was a detour. "Can Crystal not do it?" So a session that makes him a
// PDF runs push_file.py on the laptop, and it lands here: newest first, one tap
// to open in the iPhone's own viewer (the share sheet: Books, Files, print).
//
// Like the audio shelf, the bytes need the key header, so they are fetched with
// the phone key and kept in IndexedDB. A file opened once opens again with no
// signal. Cached copies of files that left the list (30 day TTL) are dropped.

import { api, WORKER, key, el, md, lsGet, lsSet, idbGet, idbSet, idbDel } from "./core.js";

const LIST_KEY = "crystal.files.list";
const SAVED_KEY = "crystal.files.saved"; // {"<id>": "<at>"}: which versions are in IndexedDB
const blobKey = (id) => "crystal.file." + id;

let shelf = null;

const size = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");

export function filesCard() {
  if (!shelf) {
    shelf = el("section", { class: "episode files" });
    shelf.appendChild(el("div", { class: "eyebrow" }, "files"));
    shelf.appendChild(el("div", { class: "elist" }));
  }
  const cached = lsGet(LIST_KEY, null);
  paint(cached ? cached.items || [] : null);
  refresh();
  return shelf;
}

function refresh() {
  api("/file")
    .then((data) => {
      lsSet(LIST_KEY, data);
      paint(data.items || []);
      prune(data.items || []);
    })
    .catch((e) => {
      if (e === "auth") return;
      const list = shelf.querySelector(".elist");
      if (e === "empty" || !lsGet(LIST_KEY, null)) paint([]);
      else if (!list.querySelector(".offline")) {
        list.prepend(el("div", { class: "banner offline" }, "Offline. Files you opened before still open."));
      }
    });
}

function paint(items) {
  const list = shelf.querySelector(".elist");
  list.innerHTML = "";
  if (items === null) { list.appendChild(el("p", { class: "empty" }, "Checking for files…")); return; }
  // An empty shelf is noise above the notes; say nothing until there is a file.
  shelf.hidden = !items.length;
  const saved = lsGet(SAVED_KEY, {}) || {};
  items.forEach((m) => {
    const row = el("button", { type: "button", class: "erow" });
    row.appendChild(el("span", { class: "eplayglyph" }, m.type === "application/pdf" ? "📄" : "🖼️"));
    const txt = el("span", { class: "etext" });
    txt.appendChild(el("b", {}, md(m.title || m.name || m.id)));
    const bits = [m.made ? "made " + m.made : "", size(m.bytes || 0), saved[m.id] === m.at ? "saved on phone" : ""];
    txt.appendChild(el("small", {}, md(bits.filter(Boolean).join(" · "))));
    if (m.note) txt.appendChild(el("small", {}, md(m.note)));
    row.appendChild(txt);
    row.addEventListener("click", () => openFile(m, row));
    list.appendChild(row);
  });
}

async function blobFor(m) {
  const hit = await idbGet(blobKey(m.id), null);
  if (hit && hit.at === m.at && hit.blob) return hit.blob;
  const r = await fetch(WORKER + "/file?id=" + encodeURIComponent(m.id), { headers: { "x-brief-key": key() } });
  if (!r.ok) throw new Error("http " + r.status);
  const blob = await r.blob();
  if (await idbSet(blobKey(m.id), { at: m.at, blob })) {
    const saved = lsGet(SAVED_KEY, {}) || {};
    saved[m.id] = m.at;
    lsSet(SAVED_KEY, saved);
  }
  return blob;
}

async function openFile(m, row) {
  const glyph = row.querySelector(".eplayglyph");
  const was = glyph.textContent;
  glyph.textContent = "…";
  try {
    const blob = await blobFor(m);
    const name = m.name || m.id + (m.type === "application/pdf" ? ".pdf" : "");
    const file = new File([blob], name, { type: m.type || blob.type });
    // The share sheet is the iPhone's real file viewer: a preview on top, then
    // Books, Files, Print. A PWA in standalone mode has no way back from a
    // navigated blob: URL, so that is only the fallback.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: m.title || name }).catch(() => {});
    } else {
      const url = URL.createObjectURL(file);
      const a = el("a", { href: url, download: name, target: "_blank", rel: "noopener" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    paint((lsGet(LIST_KEY, null) || {}).items || []);
  } catch (e) {
    glyph.textContent = was;
    row.appendChild(el("small", { class: "stale" }, navigator.onLine === false
      ? "Not saved on the phone yet. Open it once with signal."
      : "Could not fetch it. Pull to refresh and try again."));
    return;
  }
  glyph.textContent = was;
}

function prune(items) {
  const live = new Set(items.map((m) => m.id));
  const saved = lsGet(SAVED_KEY, {}) || {};
  let changed = false;
  Object.keys(saved).forEach((id) => {
    if (!live.has(id)) { idbDel(blobKey(id)); delete saved[id]; changed = true; }
  });
  if (changed) lsSet(SAVED_KEY, saved);
}
