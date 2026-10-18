// episode.js: the audio shelf. LISTEN's Audio tab holds every file; NEWS
// carries today's news episode alone at the top of the front page.
//
// David, 2026-10-06: "In the listen tab of Crystal, there should be these
// things ... audio files ... I can just click on and listen to." So: a list of
// MP3s the laptop pushed (the daily walk episode, prototypes, one-offs), each
// one tap to play, one shared player.
//
// David, 2026-10-18 (Desk d-20261018-516f81bb, d-20261018-f5cc2200): audio
// gets its own tab in LISTEN instead of sitting above the podcast queue, and
// "the link to the audio file of the Fitzsimmons news show could be on the
// news tab ... the first thing, and it would just be that day. I wouldn't see
// any other days. The other days could be stored in the audio tab." So the
// shelf is built per scope: "all" for Listen, "news" for today's news only.
//
// The daily episode is built minutes before the walk from live state and may
// be rebuilt when the board changes (his rule, 2026-10-05: "it needs to be
// made after our last conversation"). So every row says WHEN it was built and
// what it was built from, the list is re-fetched each time the tab opens, and
// a newer build replaces the cached audio.
//
// An <audio src> cannot send the key header, so the MP3 is fetched with the
// phone key, kept in IndexedDB (it still plays with no signal mid-walk), and
// played from a blob URL. Position and speed are remembered per build, and
// both shelves share them, so a news episode started on NEWS resumes in
// Listen at the same second.

import { api, WORKER, key, el, md, lsGet, lsSet, idbGet, idbSet, fmtBuilt, todayIso, fmtDay } from "./core.js";

const BLOB_KEY = "crystal.episode.blob"; // the most recently played file only
const POS_KEY = "crystal.episode.pos";   // {"<id>": {built, t}}
const RATE_KEY = "crystal.episode.rate";
const META_KEY = "crystal.episode.list";
const RATES = [1, 1.15, 1.3, 1.5];

// Which items a scope shows. "news" is today's news episode only, one row:
// the duet when both a duet and a single-narrator read exist, else the newest
// build. Exported for tools/test_episode_scope.mjs.
export function pick(scope, items, today) {
  if (scope !== "news") return items;
  const mine = items.filter((m) => m.kind === "news" && m.date === today);
  if (!mine.length) return [];
  const newest = (a, b) => String(b.built || b.at || "").localeCompare(String(a.built || a.at || ""));
  const duets = mine.filter((m) => /-duet$/.test(String(m.id || ""))).sort(newest);
  return [(duets.length ? duets : mine.sort(newest))[0]];
}

// One shelf per scope per page load. listen.js and news.js clear root and
// redraw on every tap and again when the network answers; re-inserting the
// SAME node in the same task keeps a playing <audio> playing (the spec only
// pauses a media element still detached at the next stable state). A fresh
// node would cut the walk off mid-sentence.
const shelves = {};

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

// scope "all" (Listen > Audio) or "news" (top of NEWS, today only)
export function episodeCard(scope = "all") {
  const had = shelves[scope];
  if (had) {
    if (!had.playing) refresh(had);
    return had.node;
  }
  const s = { scope, node: null, playing: false, current: null, objUrl: "" };
  shelves[scope] = s;
  const shelf = el("section", { class: "episode" + (scope === "news" ? " enews" : "") });
  s.node = shelf;
  shelf.appendChild(el("div", { class: "eyebrow" }, scope === "news" ? "today's episode" : "audio"));
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
    if (!s.current || Math.abs(audio.currentTime - last) < 5) return;
    last = audio.currentTime;
    savePos(s.current, audio.currentTime);
  });
  audio.addEventListener("pause", () => { s.playing = false; if (s.current) savePos(s.current, audio.currentTime); });
  audio.addEventListener("ended", () => { s.playing = false; });
  audio.addEventListener("play", () => {
    // one voice at a time: starting this shelf pauses the other one
    Object.values(shelves).forEach((o) => {
      if (o !== s) { const a = o.node.querySelector("audio"); if (a && !a.paused) a.pause(); }
    });
    s.playing = true;
    audio.playbackRate = lsGet(RATE_KEY, 1.15); // a new src resets the speed
    if ("mediaSession" in navigator && s.current) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: s.current.title || "Crystal audio", artist: "Crystal" });
      } catch {}
    }
  });

  const cached = lsGet(META_KEY, null);
  if (cached) paintList(s, cached.items || []);
  refresh(s);
  return shelf;
}

// The scope's shelf while it is playing, else null. A NEWS story page mounts
// it so opening a story does not detach the <audio> and stop the episode.
export function playingShelf(scope) {
  const s = shelves[scope];
  return s && s.playing ? s.node : null;
}

function refresh(s) {
  api("/episode")
    .then((data) => {
      const was = JSON.stringify(lsGet(META_KEY, null));
      lsSet(META_KEY, data);
      if (s.playing && was === JSON.stringify(data)) return;
      paintList(s, data.items || []);
    })
    .catch((e) => {
      if (e === "auth") return;
      const list = s.node.querySelector(".elist");
      if (e === "empty" || !lsGet(META_KEY, null)) {
        paintList(s, []);
      } else if (!list.querySelector(".offline")) {
        list.prepend(el("div", { class: "banner offline" }, "Offline. This is the list from earlier."));
      }
    });
}

function paintList(s, all) {
  const today = todayIso();
  const items = pick(s.scope, all, today);
  const list = s.node.querySelector(".elist");
  list.innerHTML = "";
  if (!items.length) {
    list.appendChild(el("p", { class: "empty" }, s.scope === "news"
      ? "Today's episode is not built yet. It lands here when it is."
      : "No audio yet. The daily episode lands here before the walk."));
    return;
  }
  items.forEach((m) => {
    const row = el("button", { type: "button", class: "erow" + (s.current && s.current.id === m.id ? " on" : "") });
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
    row.addEventListener("click", () => start(s, m, row));
    list.appendChild(row);
  });
}

async function start(s, meta, row) {
  const player = s.node.querySelector(".eplayer");
  const audio = player.querySelector("audio");
  if (s.current && s.current.id === meta.id && s.current.built === meta.built && audio.src) {
    player.hidden = false;
    audio.play().catch(() => {});
    return;
  }
  const glyph = row.querySelector(".eplayglyph");
  glyph.textContent = "…";
  try {
    const blob = await audioFor(meta);
    if (s.objUrl) URL.revokeObjectURL(s.objUrl);
    s.objUrl = URL.createObjectURL(blob);
    s.current = meta;
    audio.src = s.objUrl;
    const t = posOf(meta);
    if (t > 5) audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; }, { once: true });
    player.hidden = false;
    player.querySelector(".enow").innerHTML = "";
    player.querySelector(".enow").appendChild(el("b", {}, md(meta.title || meta.id)));
    paintChapters(s, meta, audio);
    s.node.querySelectorAll(".erow").forEach((r) => r.classList.toggle("on", r === row));
    glyph.textContent = "▶";
    audio.play().catch(() => {});
  } catch {
    glyph.textContent = "⟳";
    row.querySelector("small").textContent = "Download failed. Tap to try again.";
  }
}

function paintChapters(s, meta, audio) {
  const ch = s.node.querySelector(".echapters");
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
