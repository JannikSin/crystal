// app.js: the router and the boot. Seven tabs, one table, no framework.
// Each tab module owns its own fetching, caching and rendering; this file only
// decides which one gets the screen.

import { root, tabbar, key, keyScreen, setRouter, go } from "./core.js";
import { flush, flushUploads } from "./sync.js";
import * as today from "./today.js";
import * as news from "./news.js";
import * as markets from "./markets.js";
import * as money from "./money.js";
import * as career from "./career.js";
import * as listen from "./listen.js";
import * as library from "./library.js";

const ROUTES = { today, news, markets, money, career, listen, library };

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
