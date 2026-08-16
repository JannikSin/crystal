// app.js: the router and the boot. Eight tabs, one table, no framework.
// Each tab module owns its own fetching, caching and rendering; this file only
// decides which one gets the screen.

import { root, tabbar, key, keyScreen, setRouter, go, el } from "./core.js";
import { flush, flushUploads, queueDesk, uploadEnqueue } from "./sync.js";
import * as today from "./today.js";
import * as news from "./news.js";
import * as markets from "./markets.js";
import * as money from "./money.js";
import * as career from "./career.js";
import * as listen from "./listen.js";
import * as library from "./library.js";
import * as shopping from "./shopping.js";
import * as desk from "./desk.js";

const ROUTES = { today, news, markets, money, career, shopping, listen, library, desk };

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
// through the hourly triage drain. The Desk TAB stays as the read-side board;
// this is the write side, everywhere.
const bubble = el("button", { type: "button", class: "bubble", "aria-label": "Tell Crystal" }, "🪞");
const panel = el("div", { class: "bubblepanel" });
panel.hidden = true;
const bta = document.createElement("textarea");
bta.placeholder = "Tell Crystal. A thought, a fix, an idea...";
const brow = el("div", { class: "row" });
const bstat = el("span", { class: "stat" }, "");
const bsend = el("button", { type: "button", class: "send" }, "Send");
bsend.addEventListener("click", () => {
  const text = bta.value.trim();
  if (!text) return;
  queueDesk(text);
  bta.value = "";
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
const BUBBLE_MAX_MS = 180000;
bmic.addEventListener("click", async () => {
  if (brec && brec.state === "recording") { brec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4" : "audio/webm";
    brec = new MediaRecorder(stream, { mimeType: mime });
    bchunks = [];
    brec.ondataavailable = (e) => { if (e.data && e.data.size) bchunks.push(e.data); };
    brec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      bmic.classList.remove("on");
      bmic.textContent = "🎙";
      const blob = new Blob(bchunks, { type: (bchunks[0] && bchunks[0].type) || mime });
      try {
        await uploadEnqueue({ kind: "deskaudio", date: new Date().toISOString().slice(0, 10), blob });
        bstat.textContent = "recorded, transcribes and files within the hour";
      } catch (e) {
        bstat.textContent = "this phone would not store the recording";
      }
      setTimeout(() => { bstat.textContent = ""; }, 2500);
    };
    brec.start(5000);
    setTimeout(() => { if (brec && brec.state === "recording") brec.stop(); }, BUBBLE_MAX_MS);
    bmic.classList.add("on");
    bmic.textContent = "⏹";
  } catch (e) {
    bstat.textContent = "mic unavailable; type it instead";
    setTimeout(() => { bstat.textContent = ""; }, 2500);
  }
});
brow.appendChild(bmic);
brow.appendChild(bstat);
brow.appendChild(bsend);
panel.appendChild(bta);
panel.appendChild(brow);
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
