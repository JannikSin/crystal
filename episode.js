// episode.js: the audio shelf at the top of LISTEN.
//
// David, 2026-10-06: "In the listen tab of Crystal, there should be these
// things ... audio files ... I can just click on and listen to." So: a list of
// MP3s the laptop pushed (the daily walk episode, prototypes, one-offs), each
// one tap to play, one shared player.
//
// The daily episode is built minutes before the walk from live state and may
// be rebuilt when the board changes (his rule, 2026-10-05: "it needs to be
// made after our last conversation"). So every row says WHEN it was built and
// what it was built from, the list is re-fetched each time the tab opens, and
// a newer build replaces the cached audio.
//
// An <audio src> cannot send the key header, so the MP3 is fetched with the
// phone key, kept in IndexedDB (it still plays with no signal mid-walk), and
// played from a blob URL. Position and speed are remembered per build.

import { api, WORKER, key, el, md, lsGet, lsSet, idbGet, idbSet, fmtBuilt, todayIso, fmtDay } from "./core.js";

const BLOB_KEY = "crystal.episode.blob"; // the most recently played file only
const POS_KEY = "crystal.episode.pos";   // {"<id>": {built, t}}
const RATE_KEY = "crystal.episode.rate";
const META_KEY = "crystal.episode.list";
const RATES = [1, 1.15, 1.3, 1.5];

// One shelf per page load. listen.js clears root and redraws on every filter
// tap and again when the network answers; re-inserting the SAME node in the
// same task keeps a playing <audio> playing (the spec only pauses a media
// element still detached at the next stable state). A fresh node would cut
// the walk off mid-sentence.
let shelf = null;
let playing = false;
let current = null; // the meta now loaded in the player
let objUrl = "";

const fmtClock = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

async function audioFor(meta) {
  const hit = await idbGet(BLOB_KEY, null);
  if (hit && hit.id === meta.id && hit.built === meta.built && hit.blob) return hit.blob;
  const r = await fetch(WORKER + "/episode?id=" + encodeURIComponent(meta.id), { headers: { "x-brief-key": key() } });
  if (!r.ok) throw new Error("http " + r.status);
  const blob = await r.blob();
  await idbSet(BLOB_KEY, { id: meta.id, built: meta.built, blob });
  return blob;
}

const posOf = (meta) => {
  const p = (lsGet(POS_KEY, {}) || {})[meta.id];
  return p && p.built === meta.built ? p.t : 0;
};
function savePos(meta, t) {
  const all = lsGet(POS_KEY, {}) || {};
  all[meta.id] = { built: meta.built, t: Math.floor(t) };
  lsSet(POS_KEY, all);
}

export function episodeCard() {
  if (shelf) {
    if (!playing) refresh();
    return shelf;
  }
  shelf = el("section", { class: "episode" });
  shelf.appendChild(el("div", { class: "eyebrow" }, "audio"));
  shelf.appendChild(el("div", { class: "elist" }, "<p class=\"empty\">Checking for audio…</p>"));
  const player = el("div", { class: "eplayer", hidden: "" });
  player.appendChild(el("div", { class: "enow" }));
  const audio = el("audio", { controls: "", preload: "none" });
  player.appendChild(audio);
  const rate = el("div", { class: "erates", role: "group", "aria-label": "Speed" });
  RATES.forEach((r) => {
    const b = el("button", { type: "button", "aria-pressed": r === lsGet(RATE_KEY, 1.15) ? "true" : "false" }, r + "×");
    b.addEventListener("click", () => {
      lsSet(RATE_KEY, r);
      audio.playbackRate = r;
      rate.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    });
    rate.appendChild(b);
  });
  player.appendChild(rate);
  player.appendChild(el("div", { class: "echapters" }));
  shelf.appendChild(player);

  let last = 0;
  audio.addEventListener("timeupdate", () => {
    if (!current || Math.abs(audio.currentTime - last) < 5) return;
    last = audio.currentTime;
    savePos(current, audio.currentTime);
  });
  audio.addEventListener("pause", () => { playing = false; if (current) savePos(current, audio.currentTime); });
  audio.addEventListener("ended", () => { playing = false; });
  audio.addEventListener("play", () => {
    playing = true;
    audio.playbackRate = lsGet(RATE_KEY, 1.15); // a new src resets the speed
    if ("mediaSession" in navigator && current) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: current.title || "Crystal audio", artist: "Crystal" });
      } catch {}
    }
  });

  const cached = lsGet(META_KEY, null);
  if (cached) paintList(cached.items || []);
  refresh();
  return shelf;
}

function refresh() {
  api("/episode")
    .then((data) => {
      const was = JSON.stringify(lsGet(META_KEY, null));
      lsSet(META_KEY, data);
      if (playing && was === JSON.stringify(data)) return;
      paintList(data.items || []);
    })
    .catch((e) => {
      if (e === "auth") return;
      const list = shelf.querySelector(".elist");
      if (e === "empty" || !lsGet(META_KEY, null)) {
        list.innerHTML = "<p class=\"empty\">No audio yet. The daily episode lands here before the walk.</p>";
      } else if (!list.querySelector(".offline")) {
        list.prepend(el("div", { class: "banner offline" }, "Offline. This is the list from earlier."));
      }
    });
}

function paintList(items) {
  const list = shelf.querySelector(".elist");
  list.innerHTML = "";
  if (!items.length) {
    list.appendChild(el("p", { class: "empty" }, "No audio yet. The daily episode lands here before the walk."));
    return;
  }
  const today = todayIso();
  items.forEach((m) => {
    const row = el("button", { type: "button", class: "erow" + (current && current.id === m.id ? " on" : "") });
    const when = m.date === today ? "today" : fmtDay(m.date);
    const bits = [when, fmtBuilt(m.built || m.at)];
    if (m.seconds) bits.push(fmtClock(m.seconds));
    row.appendChild(el("span", { class: "eplayglyph" }, "▶"));
    const txt = el("span", { class: "etext" });
    txt.appendChild(el("b", {}, md(m.title || m.id)));
    txt.appendChild(el("small", {}, md(bits.filter(Boolean).join(" · "))));
    if (m.asof) txt.appendChild(el("small", { class: "asof" }, md(m.asof)));
    // a daily episode from an earlier day is old news: say so on the row
    if (m.kind === "daily" && m.date !== today) {
      txt.appendChild(el("small", { class: "stale" }, "Built for " + md(fmtDay(m.date)) + ". The plan in it is out of date."));
    }
    row.appendChild(txt);
    row.addEventListener("click", () => start(m, row));
    list.appendChild(row);
  });
}

async function start(meta, row) {
  const player = shelf.querySelector(".eplayer");
  const audio = player.querySelector("audio");
  if (current && current.id === meta.id && current.built === meta.built && audio.src) {
    player.hidden = false;
    audio.play().catch(() => {});
    return;
  }
  const glyph = row.querySelector(".eplayglyph");
  glyph.textContent = "…";
  try {
    const blob = await audioFor(meta);
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(blob);
    current = meta;
    audio.src = objUrl;
    const t = posOf(meta);
    if (t > 5) audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; }, { once: true });
    player.hidden = false;
    player.querySelector(".enow").innerHTML = "";
    player.querySelector(".enow").appendChild(el("b", {}, md(meta.title || meta.id)));
    paintChapters(meta, audio);
    shelf.querySelectorAll(".erow").forEach((r) => r.classList.toggle("on", r === row));
    glyph.textContent = "▶";
    audio.play().catch(() => {});
  } catch {
    glyph.textContent = "⟳";
    row.querySelector("small").textContent = "Download failed. Tap to try again.";
  }
}

function paintChapters(meta, audio) {
  const ch = shelf.querySelector(".echapters");
  ch.innerHTML = "";
  (meta.chapters || []).forEach((c) => {
    const b = el("button", { type: "button" }, md(fmtClock(c.t) + "  " + c.title));
    b.addEventListener("click", () => {
      const jump = () => { audio.currentTime = c.t; audio.play().catch(() => {}); };
      if (audio.readyState >= 1) jump();
      else audio.addEventListener("loadedmetadata", jump, { once: true });
    });
    ch.appendChild(b);
  });
}
