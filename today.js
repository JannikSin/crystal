// today.js: TODAY, "the timeline".
//
// The day runs down a rail on the left edge. Five slot markers (dawn, morning,
// day, evening, night), items hanging off the rail as bare labels with a
// checkbox, and a now-line placed by interpolating the clock inside its band.
// Tier is expressed ONLY as the colour of the dot. No descriptions on the
// surface: detail is one tap away, on the items that have any.

import {
  root, api, el, md, blockMd, lsGet, lsSet, lsDel, isoOf, todayIso, shiftIso, fmtBuilt,
  appFooter, renderDays, HISTORY_DAYS, WORKER, key, isTab,
} from "./core.js";
import {
  localTicks, isDone, setTick, tickControl, queueCapture, flush,
  uploadEnqueue, uploadStats,
} from "./sync.js";
import { computeReward } from "./reward.js";

// M3: the one slot table. Array order inside a slot is authoritative; the
// client never sorts. Hours 00:00-05:00 sit at the foot of night.
const SLOTS = [
  { t: "dawn", from: 5, to: 8 },
  { t: "morning", from: 8, to: 12 },
  { t: "day", from: 12, to: 17 },
  { t: "evening", from: 17, to: 21 },
  { t: "night", from: 21, to: 24 },
];

let brief = null;
let viewDate = "";       // "" = latest; else a YYYY-MM-DD picked in the switcher
let doneMap = {};
let feedback = [];       // graded answers for today + yesterday
let feedbackAsked = "";
let swapIdx = 0;         // ephemeral: a swap is a render choice, never persisted
let rewardBox = null;

export function open() { loadToday(false); }

// ---------- fetch ----------
function cacheBrief(data) {
  if (!data || !data.date) return;
  lsSet("brief.day." + data.date, data);
  const cut = new Date();
  cut.setDate(cut.getDate() - (HISTORY_DAYS + 1));
  const cutIso = isoOf(cut);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.indexOf("brief.day.") === 0 && k.slice(10) < cutIso) lsDel(k);
  }
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
      pullFeedback();
    })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") {
        if (!brief) render("", "No brief has been pushed yet. It lands with the morning build.");
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

// grades come back for today and yesterday; both are shown under the rep
function pullFeedback() {
  const stamp = todayIso();
  if (feedbackAsked === stamp) return;
  feedbackAsked = stamp;
  Promise.all([todayIso(), shiftIso(-1)].map((d) =>
    api("/feedback?date=" + d).then((r) => (r.items || []).map((i) => Object.assign({ date: d }, i))).catch(() => [])
  )).then((lists) => {
    const items = lists[0].concat(lists[1]);
    if (!items.length) return;
    feedback = items;
    if (!viewDate) render("");
  });
}

// ---------- render ----------
function render(offlineNote, emptyDayNote) {
  if (!isTab("today")) return;
  root.innerHTML = "";
  rewardBox = null;
  const isToday = !viewDate && !!brief && brief.date === todayIso();

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
  } else if (brief && !viewDate && brief.date !== todayIso()) {
    root.appendChild(el("div", { class: "banner" },
      "This brief is from " + md(brief.day) + ", not today. Open with signal to refresh."));
  }

  if (!brief) {
    root.appendChild(el("p", { class: "empty" },
      emptyDayNote || "No brief cached yet. Open with signal once."));
    root.appendChild(renderCapture());
    root.appendChild(appFooter(() => pickDay(viewDate, true)));
    return;
  }

  // B4: anything that is not a v2 timeline renders through the old card board.
  // Cached history days from before the cutover come back this way.
  if (brief.v !== 2) {
    doneMap = {};
    root.appendChild(legacyBoard());
    root.appendChild(renderCapture());
    root.appendChild(appFooter(() => pickDay(viewDate, true)));
    flush();
    return;
  }

  const date = brief.date;
  const local = localTicks(date);
  doneMap = {};
  (brief.timeline || []).forEach((it) => { doneMap[it.id] = isDone(it, local, brief.built); });

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

  root.appendChild(renderCapture());
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
  const r = computeReward(brief, doneMap, latch, swapIdx);
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
    sec.appendChild(el("div", { class: "tl-mark" },
      slot.t + '<span class="hrs">' + String(slot.from).padStart(2, "0") + "-" +
      String(slot.to).padStart(2, "0") + "</span>"));
    items.filter((it) => it.t === slot.t).forEach((it) => sec.appendChild(row(date, it)));
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

function nowTop(wrap) {
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  let band = SLOTS.find((s) => h >= s.from && h < s.to);
  let frac;
  if (band) frac = (h - band.from) / (band.to - band.from);
  else { band = SLOTS[SLOTS.length - 1]; frac = 1; } // the small hours
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
  r.appendChild(tickControl(date, it.id, doneMap[it.id], extra, (on) => {
    doneMap[it.id] = on;
    r.classList.toggle("done", on);
    paintMeter();
    paintReward();
  }));

  const hasDetail = !!it.detail || it.kind === "answer" || isScanItem(it);
  const lab = el("button", { type: "button", class: "tl-lab", "data-more": hasDetail ? "1" : "0" },
    md(it.label));
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

// ---------- the recorder ----------
// start/stop only. No pause: WebKit's paused MediaRecorder records silence.
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

  gradedFor(qid, it).forEach((card) => det.appendChild(card));

  const mime = pickMime();
  if (!qid) { btn.disabled = true; note.textContent = "No question id on this item, so nothing to file a recording against."; return; }
  if (mime === null) { btn.disabled = true; note.textContent = "This browser cannot record audio. Speak it out loud anyway."; return; }

  let rec = null, chunks = [], t0 = 0, tick = 0;
  btn.addEventListener("click", async () => {
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        btn.textContent = "Record";
        btn.setAttribute("data-on", "0");
        const durationMs = Date.now() - t0;
        const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || mime || "audio/mp4" });
        const level = await rmsOf(blob);
        note.textContent = level !== null && level < 0.01
          ? "Saved, but the audio looks silent. Check the mic and do it again."
          : "Saved on the phone. It goes up on the next signal.";
        lsSet("crystal.recorded", (lsGet("crystal.recorded", 0) || 0) + 1);
        await uploadEnqueue({ kind: "answer", date: brief.date, qid, durationMs, blob });
        paintLive(live);
      };
      rec.start();
      t0 = Date.now();
      btn.textContent = "Stop";
      btn.setAttribute("data-on", "1");
      note.textContent = "Recording. Do not send the app to the background.";
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
    const bits = [rec + " recorded", feedback.length + " graded"];
    if (s.pending) bits.push(s.pending + " waiting to send");
    if (s.dead) bits.push(s.dead + " not sent");
    live.textContent = bits.join(", ") + ".";
  });
}

function gradedFor(qid, it) {
  const out = [];
  feedback.forEach((f) => {
    const c = el("div", { class: "graded" });
    c.appendChild(el("div", { class: "g" }, "graded · " + md(f.date || "") + " · " + md(f.qid || "")));
    if (f.qid === qid && it.detail) {
      c.appendChild(el("p", {}, md(String(it.detail).split("\n")[0])));
    }
    if (f.transcriptExcerpt) c.appendChild(el("blockquote", {}, md(f.transcriptExcerpt)));
    if (f.grade !== undefined) c.appendChild(el("p", {}, md("Grade: " + f.grade)));
    if (f.workshop) blockMd(c, f.workshop);
    out.push(c);
  });
  return out;
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
    b.title = wakeState === "na" ? "Screen lock is unavailable on this iOS version" : "Keep the screen awake";
  });
}

async function acquireWake() {
  if (!navigator.wakeLock) { wakeState = "na"; return; }
  try {
    sentinel = await navigator.wakeLock.request("screen");
    wakeState = "on";
    sentinel.addEventListener("release", () => { sentinel = null; wakeState = wantWake ? "off" : "off"; paintWake(); });
  } catch (e) {
    sentinel = null;
    wakeState = "na";
  }
}

document.addEventListener("visibilitychange", () => {
  if (wantWake && !sentinel && document.visibilityState === "visible") acquireWake().then(paintWake);
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
  const folds = lsGet("brief.fold", {});
  cards.forEach((card) => {
    const fk = foldKey(card.title);
    const d = el("details", { class: "card" });
    // v2: collapsed by default, they are reference not surface. v1 keeps its
    // remembered fold state.
    if (card.blocks && !folds[fk]) d.setAttribute("open", "");
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
      const checked = card.tick.checked || !!(local[card.tick.id] || {}).done;
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
        const checked = b.checked || !!(local[b.id] || {}).done;
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
  });
  lab.appendChild(box);
  lab.appendChild(el("span", { class: "box" },
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>'));
  lab.appendChild(el("span", { class: "txt" }, textHtml));
  return lab;
}

function legacyBoard() {
  const app = el("div", { id: "app" });
  renderCards(app, brief.cards || [], brief.date, localTicks(brief.date));
  return app;
}

function renderCapture() {
  const box = el("section", { class: "capture" });
  box.appendChild(el("h2", {}, "🪞 Tell Crystal"));
  box.appendChild(el("p", { class: "hint" },
    "Type it and let it go. It lands in the vault with the morning pull."));
  const ta = document.createElement("textarea");
  ta.placeholder = "A thought, a task, a thing to file...";
  ta.setAttribute("aria-label", "Tell Crystal");
  box.appendChild(ta);
  const row = el("div", { class: "row" });
  const stat = el("span", { class: "stat" }, "");
  const send = el("button", { type: "button", class: "send" }, "Send");
  const list = el("ul", { class: "caplist", id: "caplist" });
  const paint = () => {
    list.innerHTML = "";
    lsGet("brief.caps." + todayIso(), []).slice(-6).reverse().forEach((c) => {
      const li = el("li", {});
      li.appendChild(el("span", { class: "at" }, (c.sent ? "✓" : "…") + " " + (c.at || "").slice(11, 16)));
      li.appendChild(el("span", {}, md(c.text.length > 90 ? c.text.slice(0, 90) + "..." : c.text)));
      list.appendChild(li);
    });
  };
  list.addEventListener("caps-changed", paint);
  send.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) return;
    queueCapture(text);
    ta.value = "";
    stat.textContent = "captured";
    setTimeout(() => { stat.textContent = ""; }, 2500);
    paint();
  });
  row.appendChild(stat);
  row.appendChild(send);
  box.appendChild(row);
  paint();
  box.appendChild(list);
  return box;
}
