// today.js: TODAY, "the timeline".
//
// The day runs down a rail on the left edge. Five slot markers: four clock
// bands (dawn, morning, evening, night) and the whenever pool in the middle,
// items hanging off the rail as bare labels with a checkbox, and a now-line
// placed by interpolating the clock inside its band.
// Tier is expressed ONLY as the colour of the dot. No descriptions on the
// surface: detail is one tap away, on the items that have any.

import {
  root, api, el, md, blockMd, lsGet, lsSet, todayIso, shiftIso, fmtBuilt,
  appFooter, renderDays, pruneDated, WORKER, key, isTab,
} from "./core.js";
import {
  localTicks, isDone, setTick, tickControl, flush,
  uploadEnqueue, uploadStats,
} from "./sync.js";
import { computeReward } from "./reward.js";
import { boardSection } from "./desk.js";

// M3: the one slot table. Array order inside a slot is authoritative; the
// client never sorts. Hours 00:00-05:00 sit at the foot of night.
// Two siblings must agree with this table or an item lands in the wrong band:
// SLOTS in worker/src/validate.js (which names are legal) and SLUG_SLOT in
// crystal-assistant/push_brief.py (which item goes where). Change all three.
const SLOTS = [
  { t: "dawn", from: 5, to: 8 },
  { t: "morning", from: 8, to: 12 },
  { t: "day", from: 12, to: 17 },
  { t: "evening", from: 17, to: 21 },
  { t: "night", from: 21, to: 24 },
];
// R2: "day" is no longer a clock band. It is the pool of things done whenever
// there is time, so it shows no hours (an hour range would be a promise the
// pool does not make) and the now-line never walks through it.
const POOL = "day";
// The scanned handwritten list arrives as ordinary timeline items under this
// section. The pen glyph is the only thing that separates his own writing from
// what the pipeline generated.
const PEN_SECTION = "Your list";

let brief = null;
let viewDate = "";       // "" = latest; else a YYYY-MM-DD picked in the switcher
let doneMap = {};
let swapIdx = 0;         // ephemeral: a swap is a render choice, never persisted
let rewardBox = null;

export function open() { loadToday(false); }

// ---------- fetch ----------
function cacheBrief(data) {
  if (!data || !data.date) return;
  lsSet("brief.day." + data.date, data);
  pruneDated();
}

function loadToday(force) {
  viewDate = "";
  brief = lsGet("brief.last", null);
  if (brief && !force) render("");
  api("/brief")
    .then((data) => {
      brief = data;
      lsSet("brief.last", data);
      cacheBrief(data);
      render("");
    })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") {
        // force=true skipped the cached paint, so returning here left the
        // PREVIOUS day still on screen and the tap on "today" looked dead.
        // Always paint: the cached brief is what "latest" means right now.
        render("", brief ? "" : "No brief has been pushed yet. It lands with the morning build.");
        return;
      }
      if (brief) render("Offline. Showing the last cached brief.");
      else render("");
    });
}

function pickDay(date, force) {
  viewDate = date || "";
  if (!viewDate) { loadToday(true); return; }
  const cached = lsGet("brief.day." + viewDate, null);
  if (cached && !force) { brief = cached; render(""); return; }
  api("/brief?date=" + viewDate)
    .then((data) => { brief = data; cacheBrief(data); render(""); })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { brief = null; render("", "No brief was pushed on this day."); return; }
      if (cached) { brief = cached; render("Offline. Showing the cached copy."); }
      else { brief = null; render("", "Needs signal to fetch this day."); }
    });
}

// Grades no longer render on this board at all: grading is interview prep, so
// the graded cards live on the Career tab's reps archive (David, 2026-08-16).
// The recorder below only records and says where the grade will land.

// ---------- render ----------
function render(offlineNote, emptyDayNote) {
  if (!isTab("today")) return;
  root.innerHTML = "";
  rewardBox = null;
  const isToday = !viewDate && !!brief && brief.date === todayIso();
  // RL3: the latest brief can be yesterday's if the morning build has not run.
  // It still renders, but its ticks belong to today, never backdated onto it.
  const stale = !viewDate && !!brief && brief.date !== todayIso();

  root.appendChild(header());

  const latestDate = (lsGet("brief.last", null) || {}).date || todayIso();
  root.appendChild(renderDays(viewDate || latestDate, (dateOrEmpty) => pickDay(dateOrEmpty)));

  if (offlineNote) root.appendChild(el("div", { class: "banner" }, offlineNote));
  if (brief && viewDate && viewDate !== todayIso()) {
    const b = el("div", { class: "banner" }, "Reading " + md(brief.day) + ". Ticks still count for that day. ");
    const back = el("button", { type: "button" }, "Back to today");
    back.addEventListener("click", () => pickDay(""));
    b.appendChild(back);
    root.appendChild(b);
  } else if (stale) {
    root.appendChild(el("div", { class: "banner" },
      "This brief is from " + md(brief.day) + ", not today. Anything you tick counts for today. " +
      "Open with signal to refresh."));
  }

  if (!brief) {
    root.appendChild(el("p", { class: "empty" },
      emptyDayNote || "No brief cached yet. Open with signal once."));
    root.appendChild(boardSection());
    root.appendChild(appFooter(() => pickDay(viewDate, true)));
    return;
  }

  // B4: anything that is not a v2 timeline renders through the old card board.
  // Cached history days from before the cutover come back this way.
  if (brief.v !== 2) {
    doneMap = {};
    root.appendChild(legacyBoard());
    root.appendChild(boardSection());
    root.appendChild(appFooter(() => pickDay(viewDate, true)));
    paintMeter();
    flush();
    return;
  }

  const date = stale ? todayIso() : brief.date;
  const local = localTicks(date);
  doneMap = {};
  flatItems(brief.timeline).forEach((it) => { doneMap[it.id] = isDone(it, local, brief.built); });

  // A granted fun day is the whole point of the ledger. Nothing is owed, so
  // nothing is drawn: no timeline, no cards, no reward strip nagging about it.
  if (isToday && brief.reward && brief.reward.funDay === todayIso()) {
    root.appendChild(el("p", { class: "empty" }, "Today is yours. Nothing renders."));
    root.appendChild(boardSection());
    root.appendChild(appFooter(() => pickDay(viewDate, true)));
    flush();
    return;
  }

  // M5: the reward layer only ever speaks about today
  if (isToday) {
    rewardBox = el("section", { class: "reward" });
    root.appendChild(rewardBox);
    paintReward();
  }

  if (brief.scoreboard && brief.scoreboard.length) root.appendChild(scoreboard(brief.scoreboard));

  root.appendChild(timeline(date));
  if (brief.scanThumb) root.appendChild(scanCard(brief.scanThumb));
  renderCards(root, brief.cards || [], date, local);

  root.appendChild(boardSection());
  root.appendChild(appFooter(() => pickDay(viewDate, true)));
  paintMeter();
  flush();
}

function header() {
  const head = el("header", {});
  const stamp = brief ? fmtBuilt(brief.built) : "";
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · today" + (stamp ? " · " + stamp : "")));
  if (brief) {
    const day = String(brief.day || "").replace(/,\s*\d{4}\s*$/, "").replace(/ 0(\d)/, " $1");
    head.appendChild(el("h1", {}, md(day)));
    if (brief.strap) head.appendChild(el("div", { class: "strap" }, md(brief.strap)));
  } else {
    head.appendChild(el("h1", {}, "Today"));
  }
  const row = el("div", { class: "headrow" });
  row.appendChild(el("div", { class: "meter" },
    '<span><b id="ndone">0</b> of <b id="ntot">0</b> closed</span><span id="sync"></span>'));
  row.appendChild(wakeButton());
  head.appendChild(row);
  return head;
}

function paintMeter() {
  const ids = Object.keys(doneMap);
  const nd = document.getElementById("ndone"), nt = document.getElementById("ntot");
  if (nd && nt) {
    nd.textContent = ids.filter((i) => doneMap[i]).length;
    nt.textContent = ids.length;
  }
}

// ---------- the reward strip ----------
function latchKey() { return "crystal.reveal." + (brief ? brief.date : todayIso()); }

function paintReward() {
  if (!rewardBox || !brief) return;
  const latch = lsGet(latchKey(), { daily: false, full: false });
  const r = computeReward(brief, doneMap, latch, swapIdx, new Date());
  if (r.latch.daily !== latch.daily || r.latch.full !== latch.full) lsSet(latchKey(), r.latch);
  rewardBox.innerHTML = "";
  r.lines.forEach((l) => rewardBox.appendChild(el("div", { class: "line" + (l.dim ? " dim" : "") }, md(l.text))));
  if (r.pick) {
    const b = el("button", { type: "button", class: "pick", "data-swap": r.pick.swappable ? "1" : "0" },
      md(r.pick.text));
    if (r.pick.swappable) b.addEventListener("click", () => { swapIdx++; paintReward(); });
    rewardBox.appendChild(b);
  }
  rewardBox.hidden = !r.lines.length && !r.pick;
}

// ---------- the timeline ----------
// A group (kind "group") is one row holding child ticks, possibly nested one
// level deeper (Morning routine > Supplements). The leaves are what the day
// owes: the meter, the reward engine and the done map all count leaves, never
// the group rows themselves.
export function flatItems(items) {
  const out = [];
  (items || []).forEach((it) => {
    if (it.kind === "group") out.push(...flatItems(it.children));
    else out.push(it);
  });
  return out;
}

function tierClass(it) {
  const t = String(it.tier || "work");
  return "t-" + (t === "flex" || t === "fun" ? "flex" : t);
}

// the scan belongs to the night floor item (the handwritten list). Derived from
// metadata, never from a slug: floor:true + night is that item by construction.
const isScanItem = (it) => it.kind === "scan" || (it.floor === true && it.t === "night");

function timeline(date) {
  const wrap = el("div", { class: "tl" });
  wrap.appendChild(el("div", { class: "tl-rail" }));
  const items = brief.timeline || [];

  SLOTS.forEach((slot) => {
    const sec = el("section", { class: "tl-slot", "data-slot": slot.t });
    sec.appendChild(el("div", { class: "tl-mark" }, slot.t === POOL
      ? 'whenever<span class="hrs">· as there is time</span>'
      : slot.t + '<span class="hrs">' + String(slot.from).padStart(2, "0") + "-" +
        String(slot.to).padStart(2, "0") + "</span>"));
    // payload order is authoritative inside every band, the pool included
    items.filter((it) => it.t === slot.t)
      .forEach((it) => sec.appendChild(it.kind === "group" ? groupRow(date, it) : row(date, it)));
    wrap.appendChild(sec);
  });

  const now = el("i", { class: "tl-now" }, '<b></b><i>now</i>');
  wrap.appendChild(now);
  // offsetTop is measured against .tl, so it has to be in the document first
  requestAnimationFrame(() => {
    const top = nowTop(wrap);
    if (top === null) { now.hidden = true; return; }
    now.style.top = Math.round(top) + "px";
  });
  return wrap;
}

// The clock is interpolated across the two real stretches of the day, 05-12
// and 17-24. Between them there is only the pool, so the marker pins to its
// top rather than crawling down a band that has no hours.
function nowTop(wrap) {
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  let band, frac;
  if (h >= 12 && h < 17) {
    band = SLOTS.find((s) => s.t === POOL);
    frac = 0;
  } else {
    band = SLOTS.find((s) => s.t !== POOL && h >= s.from && h < s.to);
    if (band) frac = (h - band.from) / (band.to - band.from);
    else { band = SLOTS[SLOTS.length - 1]; frac = 1; } // the small hours
  }
  const sec = wrap.querySelector('[data-slot="' + band.t + '"]');
  if (!sec) return null;
  return sec.offsetTop + frac * sec.offsetHeight;
}

function row(date, it) {
  const r = el("div", { class: "tl-row " + tierClass(it) + (doneMap[it.id] ? " done" : "") });
  // B1: the tick carries the item's full metadata; outreach retirement and the
  // vault merge both key off target.
  const extra = {
    kind: it.kind || "task",
    section: it.section || "",
    label: it.ticklabel || it.label,
    target: it.target || "",
  };
  const ctl = tickControl(date, it.id, doneMap[it.id], extra, (on) => {
    doneMap[it.id] = on;
    r.classList.toggle("done", on);
    paintMeter();
    paintReward();
  });
  // RL16: reading an old day is fine, claiming an evening on it is not. The
  // fun ledger only moves forward.
  if (it.kind === "fun" && viewDate && viewDate !== todayIso()) {
    ctl.querySelector("input").disabled = true;
    ctl.title = "Not back-fillable. The ledger only moves forward.";
  }
  r.appendChild(ctl);

  const hasDetail = !!it.detail || it.kind === "answer" || isScanItem(it);
  // the glyph is ours, not the payload's, so it is concatenated OUTSIDE md()
  const pen = it.section === PEN_SECTION ? '<span class="pen">✎ </span>' : "";
  const lab = el("button", { type: "button", class: "tl-lab", "data-more": hasDetail ? "1" : "0" },
    pen + md(it.label));
  r.appendChild(lab);

  if (!hasDetail) return r;

  const det = el("div", { class: "tl-detail" });
  det.hidden = true;
  det.style.flex = "1 0 100%";
  if (it.detail) blockMd(det, it.detail);
  if (it.kind === "answer") recorder(det, it);
  if (isScanItem(it)) scanControl(det);
  r.appendChild(det);
  lab.addEventListener("click", () => {
    det.hidden = !det.hidden;
    r.classList.toggle("open", !det.hidden);
  });
  return r;
}

// One row, children hidden behind it, collapsed on arrival: closed means ALL
// subcategories hidden, so the day reads on one screen (David, 2026-08-17).
// The group row itself has no checkbox; its count and done state are derived
// from the leaves, and a change event bubbling out of any child repaints it.
function groupRow(date, it) {
  const r = el("div", { class: "tl-row tl-group " + tierClass(it) });
  const leaves = flatItems([it]);
  const lab = el("button", { type: "button", class: "tl-lab", "data-more": "1" }, md(it.label));
  const count = el("span", { class: "gcount" }, "");
  const kids = el("div", { class: "tl-kids" });
  kids.hidden = true;
  (it.children || []).forEach((k) => kids.appendChild(k.kind === "group" ? groupRow(date, k) : row(date, k)));
  const paintCount = () => {
    const done = leaves.filter((k) => doneMap[k.id]).length;
    count.textContent = done + " of " + leaves.length;
    r.classList.toggle("done", leaves.length > 0 && done === leaves.length);
  };
  kids.addEventListener("change", paintCount);
  lab.addEventListener("click", () => {
    kids.hidden = !kids.hidden;
    r.classList.toggle("open", !kids.hidden);
  });
  r.appendChild(lab);
  r.appendChild(count);
  r.appendChild(kids);
  paintCount();
  return r;
}

// ---------- the recorder ----------
// start/stop only. No pause: WebKit's paused MediaRecorder records silence.
// A rep is one answer, not a lecture: five minutes is the hard stop, and the
// Worker refuses /answer over 6MB, so anything near that never leaves here.
const MAX_REC_MS = 5 * 60 * 1000;
const MAX_REC_BYTES = 5.5 * 1024 * 1024;
function pickMime() {
  const want = ["audio/mp4", "audio/webm"];
  if (!window.MediaRecorder) return null;
  for (const m of want) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return "";
}

function recorder(det, it) {
  const qid = it.qid || "";
  const box = el("div", { class: "rec" });
  const btn = el("button", { type: "button", "data-on": "0" }, "Record");
  const timer = el("span", { class: "t" }, "0:00");
  const note = el("div", { class: "note" }, "Start, speak, stop. Leave the app in front and it keeps recording.");
  box.appendChild(btn);
  box.appendChild(timer);
  box.appendChild(note);
  det.appendChild(box);

  const live = el("div", { class: "live" }, "");
  det.appendChild(live);
  paintLive(live);

  det.appendChild(el("p", { class: "hint" }, "Grades land on the Career tab, under interview reps."));

  const mime = pickMime();
  if (!qid) { btn.disabled = true; note.textContent = "No question id on this item, so nothing to file a recording against."; return; }
  if (mime === null) { btn.disabled = true; note.textContent = "This browser cannot record audio. Speak it out loud anyway."; return; }

  let rec = null, chunks = [], t0 = 0, tick = 0, cap = 0;
  // leaving the app kills the recorder on iOS anyway; stopping it deliberately
  // keeps the seconds already chunked instead of losing the take
  const bail = () => {
    if (document.visibilityState !== "visible" && rec && rec.state === "recording") rec.stop();
  };
  btn.addEventListener("click", async () => {
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(tick);
        clearTimeout(cap);
        document.removeEventListener("visibilitychange", bail);
        dropWakeForRec();
        stream.getTracks().forEach((t) => t.stop());
        btn.textContent = "Record";
        btn.setAttribute("data-on", "0");
        const durationMs = Date.now() - t0;
        const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || mime || "audio/mp4" });
        // refused here, where it can be redone, instead of dying as a 413 later
        if (blob.size > MAX_REC_BYTES) {
          note.textContent = "That is too long to send. Redo it shorter, two minutes is plenty.";
          return;
        }
        const level = await rmsOf(blob);
        // the note only promises a save once the store has actually taken it
        try {
          await uploadEnqueue({ kind: "answer", date: brief.date, qid, durationMs, blob });
        } catch (e) {
          note.textContent = "This phone would not store that recording. Say it again.";
          return;
        }
        lsSet("crystal.recorded", (lsGet("crystal.recorded", 0) || 0) + 1);
        note.textContent = level !== null && level < 0.01
          ? "Saved, but the audio looks silent. Check the mic and do it again."
          : "Saved. Grades run with the 6:30 morning build and land on the Career tab.";
        paintLive(live);
      };
      // a timeslice means a chunk lands every 5s, so a killed tab costs seconds
      rec.start(5000);
      t0 = Date.now();
      cap = setTimeout(() => { if (rec && rec.state === "recording") rec.stop(); }, MAX_REC_MS);
      document.addEventListener("visibilitychange", bail);
      holdWakeForRec();
      btn.textContent = "Stop";
      btn.setAttribute("data-on", "1");
      note.textContent = "Recording. Leave the app and it stops and keeps what it has. Five minutes max.";
      tick = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        timer.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      }, 500);
    } catch (e) {
      note.textContent = "The mic was refused. Allow microphone access for this app and try again.";
    }
  });
}

// RMS on the decoded buffer: a full-length recording of nothing still passes a
// word-count gate, so it gets caught here on the phone instead.
async function rmsOf(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / 48000));
    let sum = 0, n = 0;
    for (let i = 0; i < ch.length; i += step) { sum += ch[i] * ch[i]; n++; }
    if (ctx.close) ctx.close();
    return Math.sqrt(sum / (n || 1));
  } catch (e) {
    return null; // undecodable is not evidence of silence; say nothing
  }
}

// the pipeline is never allowed to be silently absent
function paintLive(live) {
  const rec = lsGet("crystal.recorded", 0) || 0;
  uploadStats().then((s) => {
    const bits = [rec + " recorded"];
    if (s.pending) bits.push(s.pending + " waiting to send");
    // a dead upload names its reason: a silent count teaches nothing
    if (s.dead) bits.push(s.dead + " not sent" + (s.why ? ", " + s.why : ""));
    bits.push("grades on the Career tab");
    live.textContent = bits.join(", ") + ".";
  });
}

// ---------- the scan ----------
function scanControl(det) {
  const btn = el("button", { type: "button", class: "scanbtn" }, "Photograph the list");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.style.display = "none";
  const stat = el("div", { class: "live" }, "");
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    stat.textContent = "Shrinking…";
    try {
      const blob = await downscale(file, 1400);
      await uploadEnqueue({ kind: "scan", date: brief.date, blob });
      stat.textContent = "Saved on the phone. It goes up on the next signal.";
    } catch (e) {
      stat.textContent = "That image would not open. Try the photo again.";
    }
    input.value = "";
  });
  det.appendChild(btn);
  det.appendChild(input);
  det.appendChild(stat);
}

// Decode through createImageBitmap, falling back to a data: URL. Never a
// blob: URL: the page's img-src is 'self' data: and a blob URL would be blocked.
async function downscale(file, max) {
  const src = window.createImageBitmap ? await createImageBitmap(file) : await imgFromDataUrl(file);
  const w = src.width, h = src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.8));
}

function imgFromDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("decode failed"));
      img.src = fr.result;
    };
    fr.onerror = () => rej(new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

// yesterday's list, as a thumbnail the pipeline embedded. Tap pulls the full
// JPEG through the key-gated route and swaps it in as a data URL: the image is
// never built by concatenating anything into HTML.
function scanCard(thumb) {
  const date = shiftIso(-1);
  const card = el("button", { type: "button", class: "scanrow" });
  const img = new Image();
  img.alt = "Yesterday's handwritten list";
  img.src = thumb;
  const meta = el("div", {});
  meta.appendChild(el("div", { class: "t" }, "Yesterday's list"));
  meta.appendChild(el("div", { class: "s" }, "tap for the full page"));
  card.appendChild(img);
  card.appendChild(meta);
  const holder = el("div", {});
  holder.appendChild(card);
  card.addEventListener("click", () => {
    if (holder.querySelector(".scanfull")) { holder.querySelector(".scanfull").remove(); return; }
    meta.querySelector(".s").textContent = "opening…";
    fetch(WORKER + "/scan?date=" + date, { headers: { "x-brief-key": key() } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then((b) => new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(b);
      }))
      .then((dataUrl) => {
        const full = new Image();
        full.className = "scanfull";
        full.alt = "Yesterday's handwritten list, full page";
        full.src = dataUrl;
        holder.appendChild(full);
        meta.querySelector(".s").textContent = "tap to close";
      })
      .catch(() => { meta.querySelector(".s").textContent = "not on the Worker any more"; });
  });
  return holder;
}

// ---------- wake lock ----------
// WebKit kept Wake Lock broken in home-screen standalone apps until iOS 18.4,
// so the request is wrapped and a rejection is a real state on the button. The
// toggle reflects the SENTINEL, never the tap.
let wantWake = false;
let sentinel = null;
let wakeState = "off"; // off | on | na

function wakeButton() {
  const b = el("button", { type: "button", class: "wake", "data-state": wakeState, "aria-label": "Keep the screen awake" }, "🌙");
  b.title = "Keep the screen awake";
  b.addEventListener("click", async () => {
    if (sentinel) {
      wantWake = false;
      try { await sentinel.release(); } catch (e) {}
      sentinel = null;
      wakeState = "off";
    } else {
      wantWake = true;
      await acquireWake();
    }
    paintWake();
  });
  return b;
}

function paintWake() {
  document.querySelectorAll(".wake").forEach((b) => {
    b.setAttribute("data-state", wakeState);
    b.title = wakeState === "na"
      ? "This browser refused to keep the screen awake"
      : "Keep the screen awake";
  });
}

// A rejection is two different facts wearing one error. No API at all, or an
// old iOS that never grants it, is "na" and the button should say so. A
// rejection while the page is not the active document is transient, worth one
// retry, and must not brand the feature dead for the rest of the session.
async function acquireWake(retried) {
  if (!navigator.wakeLock) { wakeState = "na"; return; }
  try {
    sentinel = await navigator.wakeLock.request("screen");
    wakeState = "on";
    sentinel.addEventListener("release", () => { sentinel = null; wakeState = "off"; paintWake(); });
  } catch (e) {
    sentinel = null;
    if (document.visibilityState !== "visible") { wakeState = "off"; return; }
    if (!retried) { await acquireWake(true); return; }
    wakeState = "na";
  }
}

// RL15: the screen going dark is the commonest way a recording dies. Held for
// the length of the take, and only released if the recorder is what took it.
let recHeldWake = false;

async function holdWakeForRec() {
  if (sentinel) return; // the toggle already holds one, leave it alone
  wantWake = true;
  await acquireWake();
  recHeldWake = !!sentinel;
  paintWake();
}

async function dropWakeForRec() {
  if (!recHeldWake) return;
  recHeldWake = false;
  wantWake = false;
  if (sentinel) { try { await sentinel.release(); } catch (e) {} sentinel = null; }
  wakeState = "off";
  paintWake();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (wantWake && !sentinel) acquireWake().then(paintWake);
  // RL9: the phone was in a pocket over midnight. The board on screen is
  // yesterday's, so go get today's before he ticks anything against it.
  if (isTab("today") && !viewDate && brief && brief.date !== todayIso()) loadToday(true);
});

// ---------- scoreboard, cards, capture ----------
function scoreboard(rows) {
  const t = el("section", { class: "score" });
  t.appendChild(el("div", { class: "eyebrow" }, "scoreboard · this week"));
  rows.forEach((r) => {
    const row = el("div", { class: "row" });
    row.appendChild(el("span", { class: "num" }, md(r.week)));
    row.appendChild(el("span", { class: "lbl" }, md(r.label)));
    if (r.goal) row.appendChild(el("span", { class: "goal" }, md(r.goal)));
    t.appendChild(row);
  });
  return t;
}

const foldKey = (title) => String(title).replace(/\(.*$/, "").trim();

// v2 cards are {title, md}; v1 cards are {title, blocks[], tick}. One renderer
// handles both, because cached history days still arrive in the old shape.
function renderCards(into, cards, date, local) {
  cards.forEach((card) => {
    const fk = foldKey(card.title);
    const d = el("details", { class: "card" });
    // Every card is collapsed on arrival, v1 and v2 alike: they are reference,
    // not surface, and a wall of open v1 cards buried the timeline. The
    // remembered fold state still applies once he opens one.
    d.addEventListener("toggle", () => {
      const f = lsGet("brief.fold", {});
      if (d.open) delete f[fk]; else f[fk] = true;
      lsSet("brief.fold", f);
    });
    const sum = el("summary", {});
    sum.appendChild(el("span", { class: "t" }, md(card.title)));
    sum.appendChild(el("span", { class: "n" }, ""));
    d.appendChild(sum);
    const body = el("div", { class: "cardbody" });

    if (card.tick) {
      const checked = isDone({ id: card.tick.id, state: card.tick.checked }, local, brief.built);
      body.appendChild(legacyTick(date, card.tick.id, md(card.tick.label), checked, {
        kind: card.kind || "action", section: card.title,
        label: card.tick.label, target: card.tick.target || "",
      }, "cardtick"));
    }
    if (card.md) blockMd(body, card.md);
    let ul = null;
    (card.blocks || []).forEach((b) => {
      if (b.t === "li") {
        if (!ul) { ul = el("ul", {}); body.appendChild(ul); }
        ul.appendChild(el("li", {}, md(b.md)));
        return;
      }
      ul = null;
      if (b.t === "tick") {
        const checked = isDone({ id: b.id, state: b.checked }, local, brief.built);
        body.appendChild(legacyTick(date, b.id, md(b.md), checked, {
          kind: "task", section: card.title, label: String(b.md).slice(0, 120),
        }));
      } else {
        body.appendChild(el("p", b.t === "num" ? { class: "num" } : {}, md(b.md)));
      }
    });
    d.appendChild(body);
    into.appendChild(d);
  });
}

function legacyTick(date, id, textHtml, checked, extra, cls) {
  const lab = el("label", { class: "tick" + (cls ? " " + cls : "") + (checked ? " done" : "") });
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => {
    setTick(date, id, box.checked, extra);
    lab.classList.toggle("done", box.checked);
    // only ids the meter is already counting, so a v2 card tick never inflates
    // the timeline total
    if (id in doneMap) { doneMap[id] = box.checked; paintMeter(); }
  });
  lab.appendChild(box);
  lab.appendChild(el("span", { class: "box" },
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>'));
  lab.appendChild(el("span", { class: "txt" }, textHtml));
  return lab;
}

// The old board has no timeline, so its ticks ARE the day: the meter counts
// them, merged by the same rule the timeline uses.
function legacyBoard() {
  const app = el("div", { id: "app" });
  const local = localTicks(brief.date);
  (brief.cards || []).forEach((c) => {
    if (c.tick) doneMap[c.tick.id] = isDone({ id: c.tick.id, state: c.tick.checked }, local, brief.built);
    (c.blocks || []).forEach((b) => {
      if (b.t === "tick") doneMap[b.id] = isDone({ id: b.id, state: b.checked }, local, brief.built);
    });
  });
  renderCards(app, brief.cards || [], brief.date, local);
  return app;
}

// "Tell Crystal" used to live here; the floating bubble on every tab is the
// write side now, and the Desk board (desk.js boardSection) took this spot.
