// sync.js: everything that leaves the phone.
//
// Two pipes, deliberately separate:
//   1. brief.queue in localStorage: small JSON deltas (ticks, captures, news
//      reads). Strict FIFO, one in flight, survives a cold start.
//   2. the `uploads` IndexedDB store: media blobs (a scanned list, a spoken
//      answer). Blobs NEVER touch localStorage, never get base64'd, and never
//      ride inside the JSON queue, so a 6MB recording can never wedge a tick.

import { WORKER, key, lsGet, lsSet, nowIso, todayIso, el, CHECK_SVG } from "./core.js";

// ---------- tick state, with tombstones ----------
export const ticksKey = (date) => "brief.ticks." + date;
export const localTicks = (date) => lsGet(ticksKey(date), {});

// M2: an untick writes {done:false, at} instead of deleting the key, so a
// deliberate untick is not silently undone by an older payload state. Local
// wins only when it is NEWER than the build that produced the payload.
function newer(a, b) {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (isFinite(ta) && isFinite(tb)) return ta > tb;
  return String(a) > String(b); // both are YYYY-MM-DDTHH:MM:SS prefixed
}

// The one merge rule, used by every renderer that shows a checkbox.
export function isDone(item, local, built) {
  const l = local && local[item.id];
  if (l) {
    if (l.done) return true;
    if (!built || newer(l.at, built)) return false;
  }
  return !!item.state;
}

export function setTick(date, id, done, extra) {
  const t = localTicks(date);
  const at = nowIso();
  t[id] = Object.assign({ done: !!done, at }, extra || {});
  lsSet(ticksKey(date), t);
  let q = lsGet("brief.queue", []);
  // replace any queued delta for the same box; only the last state matters
  q = q.filter((d) => d.type !== "tick" || !(d.date === date && d.id === id));
  q.push(Object.assign({ type: "tick", date, id, done: !!done, at }, extra || {}));
  lsSet("brief.queue", q);
  flush();
}

export function queueCapture(text) {
  const date = todayIso();
  const item = { type: "capture", date, text, at: nowIso() };
  const q = lsGet("brief.queue", []);
  q.push(item);
  lsSet("brief.queue", q);
  const caps = lsGet("brief.caps." + date, []);
  caps.push({ text, at: item.at, sent: false });
  lsSet("brief.caps." + date, caps);
  flush();
}

export const readSetOf = (date) => lsGet("crystal.read." + date, []);

export function markRead(date, ids) {
  const cur = readSetOf(date);
  const have = new Set(cur);
  const add = ids.filter((i) => !have.has(i));
  if (!add.length) return;
  lsSet("crystal.read." + date, cur.concat(add));
  const q = lsGet("brief.queue", []);
  let found = null;
  q.forEach((d) => { if (d.type === "newsread" && d.date === date) found = d; });
  if (found) add.forEach((i) => { if (found.ids.indexOf(i) < 0) found.ids.push(i); });
  else q.push({ type: "newsread", date, ids: add });
  lsSet("brief.queue", q);
  flush();
}

function markCapSent(d) {
  const caps = lsGet("brief.caps." + d.date, []);
  caps.forEach((c) => { if (c.at === d.at && c.text === d.text) c.sent = true; });
  lsSet("brief.caps." + d.date, caps);
  const list = document.getElementById("caplist");
  if (list) list.dispatchEvent(new CustomEvent("caps-changed"));
}

export function syncStamp(text) {
  const e = document.getElementById("sync");
  if (e) e.textContent = text;
}

// ---------- the JSON queue pump ----------
let flushing = false;

export function flush() {
  if (flushing) return;
  const q = lsGet("brief.queue", []);
  if (!q.length) { syncStamp("synced"); flushUploads(); return; }
  if (!navigator.onLine) { syncStamp(q.length + " waiting for signal"); return; }
  flushing = true;
  const d = q[0];
  const path = d.type === "capture" ? "/capture" : d.type === "newsread" ? "/newsread" : "/ticks";
  const body = d.type === "capture" ? { date: d.date, text: d.text, at: d.at }
    : d.type === "newsread" ? { date: d.date, ids: d.ids }
    : d;
  fetch(WORKER + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-brief-key": key() },
    body: JSON.stringify(body),
  }).then((r) => {
    flushing = false;
    // Drop the head on any 4xx: the Worker has judged the payload itself and
    // retrying it forever wedges everything behind it. 401 is the exception,
    // because that is an auth STATE, not a bad delta: the key screen is already
    // up, the delta is still good, and dropping it would lose a real tick.
    if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401)) {
      const q2 = lsGet("brief.queue", []);
      q2.shift();
      lsSet("brief.queue", q2);
      if (r.ok && d.type === "capture") markCapSent(d);
      flush();
    } else {
      syncStamp(q.length + " not synced (" + r.status + ")");
    }
  }).catch(() => {
    flushing = false;
    syncStamp(q.length + " saved on phone, will sync");
  });
}

// ---------- the blob store ----------
const DB_NAME = "crystal";
const STORE = "uploads";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

// {kind:"scan"|"answer", date, qid?, durationMs?, blob, tries, dead?, createdAt}
export function uploadEnqueue(rec) {
  return tx("readwrite", (s) => s.add(Object.assign({ tries: 0, createdAt: nowIso() }, rec)))
    .then((id) => { flushUploads(); return id; });
}

export function uploadsAll() {
  return tx("readonly", (s) => s.getAll()).then((v) => v || []).catch(() => []);
}

const uploadPut = (rec) => tx("readwrite", (s) => s.put(rec));
const uploadDel = (id) => tx("readwrite", (s) => s.delete(id));

// "2 waiting, 1 not sent" for the liveness line.
export function uploadStats() {
  return uploadsAll().then((all) => ({
    pending: all.filter((r) => !r.dead).length,
    dead: all.filter((r) => r.dead).length,
  }));
}

let pumping = false;
let nextTry = 0;

export function flushUploads() {
  if (pumping || !navigator.onLine || Date.now() < nextTry) return Promise.resolve();
  pumping = true;
  return uploadsAll().then(async (all) => {
    for (const rec of all) {
      if (rec.dead) continue;
      const path = rec.kind === "scan"
        ? "/scan?date=" + encodeURIComponent(rec.date)
        : "/answer?date=" + encodeURIComponent(rec.date) + "&qid=" + encodeURIComponent(rec.qid || "");
      let r;
      try {
        r = await fetch(WORKER + path, {
          method: "POST",
          headers: { "content-type": rec.blob.type || (rec.kind === "scan" ? "image/jpeg" : "audio/mp4"), "x-brief-key": key() },
          body: rec.blob,
        });
      } catch (e) {
        // no signal: back off and try the whole store again later
        rec.tries = (rec.tries || 0) + 1;
        await uploadPut(rec);
        nextTry = Date.now() + Math.min(60000, 4000 * rec.tries);
        break;
      }
      if (r.ok) { await uploadDel(rec.id); continue; }
      if (r.status >= 400 && r.status < 500 && r.status !== 401) {
        // the Worker refused these bytes; never retry, but keep the record so
        // the liveness line can say "1 not sent" instead of going quiet
        rec.dead = true;
        rec.status = r.status;
        await uploadPut(rec);
        continue;
      }
      rec.tries = (rec.tries || 0) + 1;
      await uploadPut(rec);
      nextTry = Date.now() + Math.min(60000, 4000 * rec.tries);
      break;
    }
  }).catch(() => {}).then(() => { pumping = false; });
}

window.addEventListener("online", () => { nextTry = 0; flush(); });
window.addEventListener("focus", () => flushUploads());

// ---------- the checkbox control ----------
// One control, six tabs. The caller owns the row around it; this owns the
// box, the tick pipe and the done class on its row.
export function tickControl(date, id, checked, extra, onChange) {
  const lab = el("label", { class: "tk" });
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !!checked;
  box.setAttribute("aria-label", (extra && extra.label) || "done");
  box.addEventListener("change", () => {
    setTick(date, id, box.checked, extra);
    if (onChange) onChange(box.checked);
  });
  lab.appendChild(box);
  lab.appendChild(el("span", { class: "box" }, CHECK_SVG));
  return lab;
}
