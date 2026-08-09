// Offline shell cache, same strategy as the sibling PWAs (tally/finesse/brief):
// icons cache-first, shell network-first with cache fallback. Content JSON is
// NOT cached here: it is cross-origin (the Worker) and the app keeps its own
// last-known copies in localStorage.
// Cache name must stay crystal-prefixed: the PWAs share the janniksin.github.io
// origin and each SW deletes only its own prefix.
// v5: the caching rules themselves changed (ok + basic only), so the old cache
// is dropped rather than trusted.
// v7: round 2 shipped new CSS and four rewritten modules; a phone holding v6
// would render the new markup with the old stylesheet.
const CACHE = "crystal-v8";

const PRECACHE = [
  "./",
  "./index.html",
  "./app.css",
  "./core.js",
  "./sync.js",
  "./reward.js",
  "./today.js",
  "./news.js",
  "./markets.js",
  "./money.js",
  "./career.js",
  "./listen.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// addAll is all-or-nothing: one 404 in the list and NOTHING is cached, which on
// a phone with no signal is a white screen. Cache them one at a time, tolerate
// the misses, and activate either way; the fetch handler fills any gap later.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("crystal-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only a real same-origin 200 is worth keeping. An opaque, redirected or 404
// response cached here would be served back as the shell forever.
const keep = (res) => !!res && res.ok && res.type === "basic";

function netThenCache(request) {
  return fetch(request).then((res) => {
    if (keep(res)) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
}

function cacheFallback(request) {
  return caches.match(request).then((hit) => {
    if (hit) return hit;
    if (request.mode === "navigate") return caches.match("./index.html").then((s) => s || Response.error());
    return Response.error();
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.includes("/icons/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || netThenCache(e.request)));
    return;
  }

  // Network first, but one bar of signal must not hold the shell hostage: at
  // 1.5s the cached copy wins the race and the fetch still fills the cache.
  const net = netThenCache(e.request).catch(() => null);
  const slow = new Promise((r) => setTimeout(r, 1500)).then(() => caches.match(e.request));
  e.respondWith(
    Promise.race([net, slow])
      .then((res) => res || net)
      .then((res) => res || cacheFallback(e.request)),
  );
});
