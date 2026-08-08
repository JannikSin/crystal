// app.js: the router and the boot. Six tabs, one table, no framework.
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

const ROUTES = { today, news, markets, money, career, listen };

function route() {
  if (!key()) { keyScreen(""); return; }
  tabbar.hidden = false;
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").map(decodeURIComponent).filter(Boolean);
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
  // guarded, so a refresh loop can never happen.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}
