// app.js: the router and the boot. Eight tabs, one table, no framework.
// Each tab module owns its own fetching, caching and rendering; this file only
// decides which one gets the screen.

import { root, tabbar, key, keyScreen, setRouter, go, el } from "./core.js";
import { flush, flushUploads, queueDesk, uploadEnqueue } from "./sync.js";
import * as today from "./today.js";
import * as news from "./news.js";
import * as money from "./money.js";
import * as career from "./career.js";
import * as listen from "./listen.js";
import * as library from "./library.js";
import * as shopping from "./shopping.js";

// The Desk TAB is gone (David, 2026-08-17): the bubble below is the write
// side on every tab, and the board renders at the foot of Today. An old
// #/desk hash falls through the unknown-tab guard onto Today. The Markets
// tab followed the same day: its digest lives at the foot of Money now.
const ROUTES = { today, news, money, career, shopping, listen, library };

function route() {
  if (!key()) { keyScreen(""); return; }
  tabbar.hidden = false;
  const h = location.hash.replace(/^#\/?/, "");
  // a hand-mangled hash (a lone %) throws in decodeURIComponent; that is a bad
  // link, not a broken app, so it lands on Today instead of a white screen
  let parts;
  try {
    parts = h.split("/").map(decodeURIComponent).filter(Boolean);
  } catch (e) {
    go("#/today");
    return;
  }
  // An unknown tab used to fall through to today.open() while the hash still
  // read #/foo, so today's own isTab() guard dropped the paint and left a blank
  // page under a highlighted tab bar. Rewrite the hash instead of retargeting.
  // Old #/markets links land where the digest lives now.
  if (parts[0] === "markets") { go("#/money"); return; }
  if (parts[0] && !ROUTES[parts[0]]) { go("#/today"); return; }
  const tab = ROUTES[parts[0]] ? parts[0] : "today";
  tabbar.querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-current", b.getAttribute("data-tab") === tab ? "true" : "false");
  });
  root.innerHTML = "";
  window.scrollTo(0, 0);
  ROUTES[tab].open(parts);
}

setRouter(route);
tabbar.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => go("#/" + b.getAttribute("data-tab")));
});
window.addEventListener("hashchange", route);

// ---------- the bubble ----------
// "I want it to be on literally every tab and I don't want it to be its own
// desk thing" (David, 2026-08-16, via the Desk itself). One floating button,
// outside the router so it survives every tab switch; it opens the same
// DESK queue (queueDesk, offline-safe FIFO), so everything typed here goes
// through the hourly triage drain. The board it feeds renders at the foot of
// Today; this is the write side, everywhere.
const bubble = el("button", { type: "button", class: "bubble", "aria-label": "Tell Crystal" }, "🪞");
const panel = el("div", { class: "bubblepanel" });
panel.hidden = true;
const bta = document.createElement("textarea");
bta.placeholder = "Tell Crystal. A thought, a fix, an idea...";
// Long dictated notes outgrew the fixed 84px box and reviewing what was said
// meant fighting a tiny inner scroll mid-dictation. Grow with the text up to
// the CSS max-height; past that the textarea scrolls itself.
bta.addEventListener("input", () => {
  bta.style.height = "auto";
  bta.style.height = bta.scrollHeight + "px";
});
const brow = el("div", { class: "row" });
const bstat = el("span", { class: "stat" }, "");
const bsend = el("button", { type: "button", class: "send" }, "Send");
// Send is for TYPED text only, and it never said so. David, 2026-08-18: "when
// I click stop does that automatically send it, or do I have to click send
// after? So far I've been clicking send after."
//
// It does send itself, and always has: brec.onstop enqueues the upload on its
// own pipe. What he was pressing afterwards was a button that found an empty
// textarea and returned in silence, which is indistinguishable from a button
// that failed. So: stopping says SENT in as many words, and Send answers when
// there is nothing to send instead of doing nothing.
bsend.addEventListener("click", () => {
  const text = bta.value.trim();
  if (!text) {
    bstat.textContent = brec ? "the recording already sent itself when you pressed stop"
      : "nothing typed yet";
    setTimeout(() => { bstat.textContent = ""; }, 2600);
    return;
  }
  queueDesk(text);
  bta.value = "";
  bta.style.height = "auto";
  bstat.textContent = "captured, files within the hour";
  setTimeout(() => { bstat.textContent = ""; panel.hidden = true; }, 1600);
});
// The mic: the interview recorder's exact pattern (MediaRecorder, offline
// upload queue), pointed at /deskaudio. The drain transcribes with the same
// faster-whisper that grades interview reps and files the transcript as a
// normal Desk note, so spoken and typed notes end in the same place.
const bmic = el("button", { type: "button", class: "mic", "aria-label": "Record for the Desk" }, "🎙");
let brec = null;
let bchunks = [];
let bstart = 0;
let btick = null;
let bcap = null;
// 5 minutes, raised from 3 on 2026-08-22 now that the screen no longer dies
// mid-note. The real ceiling is the Worker's 6 MB /deskaudio cap, and the
// bitrate below is what keeps a five-minute note comfortably inside it:
// 64 kbps mono is more than speech recognition needs, and 5 min of it is
// about 2.4 MB, which also matters on a cell connection in a gym.
const BUBBLE_MAX_MS = 300000;
const BUBBLE_BPS = 64000;
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
bmic.addEventListener("click", async () => {
  if (brec && brec.state === "recording") { brec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4" : "audio/webm";
    brec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BUBBLE_BPS });
    bchunks = [];
    brec.ondataavailable = (e) => { if (e.data && e.data.size) bchunks.push(e.data); };
    brec.onstop = async () => {
      const secs = Math.round((Date.now() - bstart) / 1000);
      if (btick) { clearInterval(btick); btick = null; }
      if (bcap) { clearTimeout(bcap); bcap = null; }
      void today.dropWakeForRec();
      stream.getTracks().forEach((t) => t.stop());
      bmic.classList.remove("on");
      bmic.textContent = "🎙";
      const blob = new Blob(bchunks, { type: (bchunks[0] && bchunks[0].type) || mime });
      try {
        // secs rides along so the drain can compare what the PHONE recorded
        // against what the transcriber heard. "It seems to cut out at some
        // points" is unfalsifiable until those two numbers sit side by side.
        await uploadEnqueue({
          kind: "deskaudio", date: new Date().toISOString().slice(0, 10), secs, blob,
        });
        bstat.textContent = `sent, ${mmss(secs * 1000)}. Transcribes and files within the hour, no need to press Send.`;
      } catch (e) {
        bstat.textContent = "this phone would not store the recording";
      }
      setTimeout(() => { bstat.textContent = ""; }, 4000);
    };
    // NO TIMESLICE, deliberately, changed 2026-08-22.
    //
    // It used to be brec.start(5000). On iOS Safari a timesliced audio/mp4
    // recording hands back FRAGMENTS: only the first blob carries the moov
    // header, and the concatenation of the rest is a file most decoders read
    // partway and then abandon. That is a precise match for the two things
    // David reported, "the transcription seems to cut out at some points" and
    // a note that stops early, and it sits UPSTREAM of the whisper decode
    // settings that were already hardened on 2026-08-17, which is why that fix
    // did not close it. With no timeslice, ondataavailable fires once at stop
    // with one well formed file. Nothing is lost by the change: the chunks
    // only ever lived in memory either way, so a killed tab took them both.
    // THE 30 SECONDS. Nothing in this file ever stopped at 30 seconds; the
    // PHONE did. Auto-lock darkens the screen, iOS suspends the page, and
    // MediaRecorder dies with it, which he experienced as "a timeout thing,
    // it goes for like 30 seconds and it stops". The interview recorder on the
    // Today screen has held a screen wake lock for exactly this reason since
    // RL15; the bubble, which is the recorder he actually uses, never did.
    // Same lock, taken before the first byte and dropped at stop.
    void today.holdWakeForRec();
    bstart = Date.now();
    brec.start();
    // the elapsed clock is not decoration. It is the instrument that settles
    // "it goes for like 30 seconds and it stops": next time there is a number
    // on the button, and it is the same number the drain gets sent.
    bmic.textContent = "⏹ 0:00";
    btick = setInterval(() => {
      if (brec && brec.state === "recording") bmic.textContent = "⏹ " + mmss(Date.now() - bstart);
    }, 500);
    bcap = setTimeout(() => {
      if (brec && brec.state === "recording") {
        bstat.textContent = "5 minutes is the cap, stopping and sending";
        brec.stop();
      }
    }, BUBBLE_MAX_MS);
    bmic.classList.add("on");
  } catch (e) {
    // if the wake lock was taken before the throw, give it back
    void today.dropWakeForRec();
    bstat.textContent = "mic unavailable; type it instead";
    setTimeout(() => { bstat.textContent = ""; }, 2500);
  }
});
brow.appendChild(bmic);
brow.appendChild(bstat);
brow.appendChild(bsend);
panel.appendChild(bta);
panel.appendChild(brow);
// One line, said once, so the question never has to be asked again.
panel.appendChild(el("p", { class: "bhint" },
  "Speak: press 🎙, press ⏹, and it is sent. Send is only for typed text. "
  + "The screen is held awake while you record, up to 5 minutes."));
bubble.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) bta.focus();
});
document.body.appendChild(panel);
document.body.appendChild(bubble);

// ---------- boot ----------
if (!location.hash) history.replaceState(null, "", "#/today");
route();
flush();
flushUploads();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
  // A new SW taking over means the shell on screen is the old one. Reload once,
  // guarded, so a refresh loop can never happen. On the FIRST install there was
  // no controller, so nothing on screen is stale and the reload is pure churn.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}
