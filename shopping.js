// shopping.js: SHOP, "the aisle".
//
// A list you can actually hold in a store. One tap on a row opens it IN PLACE
// (the disclosure pattern career.js already uses for the roster), never a new
// window: the spec line, the reason it is on the list, and the buy link. A
// second tap closes it.
//
// The tick is deliberately PHONE-LOCAL. Every other tick in this app rides
// sync.js into the vault's daily state, and a shopping tick is not a day's
// commitment, it is "I put it in the basket". It lives in localStorage under
// crystal.shopping.got, survives reloads, and never touches the Worker. The
// vault stays the source of truth for WHAT is on the list; the phone owns
// WHICH ONES ARE IN THE CART.

import {
  root, el, md, fmtMoney, lsGet, lsSet, appFooter, emptyState, loadCached, isTab, CHECK_SVG,
} from "./core.js";

// Deliberately NOT "crystal.shopping.got": core.js clears cached payloads by
// PREFIX on a key change, so a cart stored under the payload's own prefix would
// be wiped along with it. The cart is the user's taps, not server data.
const GOT_KEY = "crystal.cart";

// Status drives colour and the section chip. Closed set, mirrored in the
// Worker's validateShopping, so an unknown value cannot reach here.
const STATUS = {
  buy: { chip: "buy now", cls: "s-buy" },
  queued: { chip: "queued", cls: "s-queued" },
  held: { chip: "held", cls: "s-held" },
  blocked: { chip: "blocked", cls: "s-blocked" },
  never: { chip: "do not rebuy", cls: "s-never" },
  got: { chip: "arrived", cls: "s-got" },
};

export function open() {
  loadCached("/shopping", "crystal.shopping", render);
}

// An item's identity has to survive the vault note being reworded, or every
// edit silently un-checks the cart. Name only, lowercased and stripped to
// alphanumerics: prices and descriptions change, the product does not.
function idOf(item) {
  return String(item.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function got() { return lsGet(GOT_KEY, {}) || {}; }
function setGot(id, on) {
  const g = got();
  if (on) g[id] = true; else delete g[id];
  lsSet(GOT_KEY, g);
}

function render(data, note, empty) {
  if (!isTab("shopping")) return;
  root.innerHTML = "";

  const head = el("header", { class: "aisle" });
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · shop"));
  head.appendChild(el("h1", {}, "The Aisle"));
  if (data && data.built) head.appendChild(el("div", { class: "strap" }, "list of " + md(String(data.built).slice(0, 10))));
  root.appendChild(head);

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  // Bolt watcher strip: its own fetch on its own clock, because the buy list
  // comes from the laptop and the watcher summary comes from GitHub Actions.
  // The placeholder goes in now so the strip lands above the list whenever the
  // (possibly slower) /bolt answer arrives; isConnected guards a tab switch.
  const boltBox = el("section", { class: "boltstrip" });
  root.appendChild(boltBox);
  loadCached("/bolt", "crystal.bolt", (b) => paintBolt(boltBox, b));

  if (empty || !data || !Array.isArray(data.sections) || !data.sections.length) {
    root.appendChild(emptyState("🛒", "Nothing on the list",
      "The buy list lands when the laptop pushes Life/Shopping-List."));
    root.appendChild(appFooter(() => loadCached("/shopping", "crystal.shopping", render, true)));
    return;
  }

  const runner = el("div", { class: "runtot" });
  root.appendChild(runner);

  const rows = [];
  data.sections.forEach((s) => root.appendChild(sectionBlock(s, rows)));

  if (Array.isArray(data.totals) && data.totals.length) {
    const t = el("section", { class: "totals" });
    t.appendChild(el("div", { class: "sh" }, "totals"));
    data.totals.forEach((x) => {
      const r = el("div", { class: "trow" });
      r.appendChild(el("span", { class: "l" }, md(x.label)));
      r.appendChild(el("span", { class: "v" }, fmtMoney(x.amount, false)));
      t.appendChild(r);
    });
    root.appendChild(t);
  }

  // "left to buy" is the only number that matters standing in a shop: the
  // buy-now rows still unticked. Recomputed on every tap.
  function retotal() {
    let n = 0, sum = 0;
    rows.forEach((r) => {
      if (r.status !== "buy" || r.isGot()) return;
      n++;
      if (typeof r.price === "number") sum += r.price;
    });
    runner.innerHTML = "";
    runner.appendChild(el("span", { class: "n" }, n === 0 ? "cart clear" : n + " left to buy"));
    if (sum > 0) runner.appendChild(el("span", { class: "v" }, "~" + fmtMoney(sum, false)));
  }
  rows.forEach((r) => { r.onChange = retotal; });
  retotal();

  root.appendChild(appFooter(() => loadCached("/shopping", "crystal.shopping", render, true)));
}

// Bolt has three halves and all three land here, because David asked to open
// one tab and see everything the agent produced (2026-08-18):
//
//   A  the WATCHER, every 6 hours, deterministic. Heartbeat plus this week's
//      alerts. A quiet week renders as a good thing on purpose; that is bolt's
//      whole design contract.
//   B  the SCOUT, weekly, exploratory. Named picks with prices and sizes, and
//      the items it deliberately killed, which is the half that shows the
//      agent exercising judgement rather than forwarding sales.
//   C  the PROMO hunter. Codes the store is advertising on its own pages,
//      first-hand and not stale. NOT verified: Shopify only resolves a code at
//      checkout, so nothing short of checkout can confirm one, and the label
//      says "advertise" rather than "work" for exactly that reason.
//
// Every row that has a product URL is a link. The old strip printed titles you
// could not tap, which made it a status light rather than a shopping tool.
// Everything rendered here is text run through md(), which escapes < & > first,
// so titles are safe. An href is NOT: it is the one place a payload string
// becomes executable, and "javascript:..." in a product url would run on tap.
// http and https only, and a bad url degrades to a plain row rather than
// dropping the find.
function safeUrl(u) {
  if (typeof u !== "string") return null;
  return /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

function boltRow(cls, bits, rawUrl) {
  const url = safeUrl(rawUrl);
  const r = el(url ? "a" : "div", url
    ? { class: cls, href: url, target: "_blank", rel: "noopener" }
    : { class: cls });
  bits.filter(Boolean).forEach((b) => r.appendChild(b));
  return r;
}

function paintBolt(box, d) {
  // Any one half is enough to draw the card. Gating on `built` alone meant a
  // scout digest could not show until the watcher had also reported.
  if (!box.isConnected || !d || !(d.built || d.digestBuilt || d.promoBuilt)) return;
  box.innerHTML = "";
  const head = el("div", { class: "bh" });
  head.appendChild(el("span", { class: "t" }, "⚡ bolt"));
  const age = d.built ? Date.now() - Date.parse(d.built) : NaN;
  const h = Math.floor(age / 3600000);
  head.appendChild(el("span", { class: "age" },
    Number.isNaN(age) ? "watcher has not reported" : age < 0 ? ""
      : h < 1 ? "checked just now" : h < 48 ? `checked ${h}h ago` : "STALE, check the repo"));
  head.appendChild(el("span", { class: "n" }, (d.tracked || 0) + " watched"));
  box.appendChild(head);

  // ---- A: the watcher's week
  const week = Array.isArray(d.week) ? d.week : [];
  if (!week.length) {
    box.appendChild(el("div", { class: "quiet" }, "Quiet week from the watcher. Nothing cleared the bar, which is the plan working."));
  } else {
    week.slice(-6).reverse().forEach((w) => {
      box.appendChild(boltRow("hit", [
        el("span", { class: "d" }, String(w.date || "").slice(5)),
        el("span", { class: "w" }, md(String(w.title || w.key || ""))),
        w.size ? el("span", { class: "sz" }, String(w.size)) : null,
        w.price ? el("span", { class: "p" }, "$" + w.price) : null,
      ], w.url));
    });
  }

  // ---- B: the scout's week
  const dg = d.digest || {};
  const finds = Array.isArray(dg.finds) ? dg.finds : [];
  if (dg.headline || finds.length) {
    const sh = el("div", { class: "bsub" });
    sh.appendChild(el("span", { class: "t" }, "scout"));
    if (d.digestBuilt) sh.appendChild(el("span", { class: "age" }, String(d.digestBuilt).slice(0, 10)));
    box.appendChild(sh);
    if (dg.headline) box.appendChild(el("p", { class: "bnote" }, md(String(dg.headline))));
    finds.forEach((f) => {
      box.appendChild(boltRow("find", [
        el("span", { class: "w" }, md(String(f.title || ""))),
        f.size ? el("span", { class: "sz" }, String(f.size)) : null,
        typeof f.price === "number" ? el("span", { class: "p" }, "$" + f.price.toFixed(2)) : null,
        typeof f.was === "number" ? el("span", { class: "was" }, "$" + f.was.toFixed(0)) : null,
      ], f.url));
      if (f.why) box.appendChild(el("div", { class: "why" }, md(String(f.why))));
    });
    // The kills are the point, not filler: they are the agent refusing to sell
    // him something, with the rule it applied.
    (Array.isArray(dg.killed) ? dg.killed : []).forEach((k) => {
      box.appendChild(el("div", { class: "killed" },
        md(String(k.title || "")) + (k.why ? " — " + md(String(k.why)) : "")));
    });
    if (dg.uncovered) box.appendChild(el("div", { class: "err" }, md(String(dg.uncovered))));
  }

  // ---- C: promo codes
  const promos = Array.isArray(d.promos) ? d.promos : [];
  if (promos.length) {
    const ph = el("div", { class: "bsub" });
    ph.appendChild(el("span", { class: "t" }, "codes these stores advertise"));
    if (d.promoBuilt) ph.appendChild(el("span", { class: "age" }, String(d.promoBuilt).slice(0, 10)));
    box.appendChild(ph);
    promos.forEach((c) => {
      const r = el("div", { class: "promo" });
      r.appendChild(el("span", { class: "store" }, md(String(c.store))));
      const code = el("button", { class: "code", type: "button" }, String(c.code));
      // Tap copies. Pasting a code by hand off a phone screen is the whole
      // friction this replaces.
      code.onclick = () => {
        navigator.clipboard?.writeText(String(c.code));
        code.textContent = "copied";
        setTimeout(() => { code.textContent = String(c.code); }, 1200);
      };
      r.appendChild(code);
      if (c.pct) r.appendChild(el("span", { class: "p" }, "-" + c.pct + "%"));
      box.appendChild(r);
    });
  }

  if (Array.isArray(d.errors) && d.errors.length) {
    box.appendChild(el("div", { class: "err" }, d.errors.length + " source" + (d.errors.length > 1 ? "s" : "") + " erroring: " + md(String(d.errors[0]).slice(0, 80))));
  }
}

function sectionBlock(s, rows) {
  const meta = STATUS[s.status] || STATUS.queued;
  const box = el("section", { class: "aislesec " + meta.cls });
  const h = el("div", { class: "sh" });
  h.appendChild(el("span", { class: "t" }, md(s.title)));
  h.appendChild(el("span", { class: "chip" }, meta.chip));
  box.appendChild(h);
  if (s.note) box.appendChild(el("p", { class: "secnote" }, md(s.note)));
  // One tap fills an Amazon cart with the whole section (the classic
  // aws/cart/add multi-ASIN URL). Only on actionable sections, and only from
  // items whose url is a real /dp/ product page; search-fallback urls and
  // non-Amazon links can't ride along. Ticked-off items still get added: the
  // tick means "in the basket", and this IS the basket.
  if (s.status === "buy" || s.status === "queued") {
    const asins = (s.items || [])
      .map((it) => (/amazon\.com\/dp\/([A-Z0-9]{10})/.exec(it.url || "") || [])[1])
      .filter(Boolean);
    if (asins.length >= 2) {
      const q = asins.map((a, i) => `ASIN.${i + 1}=${a}&Quantity.${i + 1}=1`).join("&");
      box.appendChild(el("a", {
        class: "cartall", target: "_blank", rel: "noopener",
        href: "https://www.amazon.com/gp/aws/cart/add.html?" + q,
      }, `add all ${asins.length} to Amazon cart ↗`));
    }
  }
  (s.items || []).forEach((it) => box.appendChild(itemRow(it, s.status, rows)));
  return box;
}

function itemRow(it, status, rows) {
  const id = idOf(it);
  const wrap = el("div", { class: "buyrow" });
  let isGot = !!got()[id];
  let openNow = false;

  // The tick is its own button so the row's tap area stays "show me more".
  // Two separate actions on one row means two separate controls.
  const tick = el("button", {
    type: "button", class: "tk", "aria-pressed": isGot ? "true" : "false",
    "aria-label": "In the cart: " + it.name,
  }, CHECK_SVG);

  const row = el("button", { type: "button", class: "hd", "aria-expanded": "false" });
  row.appendChild(el("span", { class: "nm" }, md(it.name)));
  row.appendChild(el("span", { class: "pr" },
    it.priceText ? md(it.priceText) : typeof it.price === "number" ? fmtMoney(it.price, false) : ""));
  row.appendChild(el("span", { class: "car" }, "›"));

  // Built once and revealed, not fetched on demand: the payload is already
  // here, so opening a row must never wait on anything.
  const body = el("div", { class: "more" });
  body.hidden = true;
  if (it.spec) body.appendChild(el("div", { class: "spec" }, md(it.spec)));
  if (it.desc) body.appendChild(el("p", {}, md(it.desc)));
  if (it.url) {
    // target=_blank on a link the user explicitly asked to follow. The row tap
    // itself never navigates, which is the whole point of the pattern.
    body.appendChild(el("a", { class: "go", href: it.url, target: "_blank", rel: "noopener" }, "open ↗"));
  }

  const api = {
    status, price: typeof it.price === "number" ? it.price : null,
    isGot: () => isGot, onChange: () => {},
  };
  rows.push(api);

  function paintGot() {
    wrap.classList.toggle("done", isGot);
    tick.setAttribute("aria-pressed", isGot ? "true" : "false");
  }
  tick.addEventListener("click", () => {
    isGot = !isGot;
    setGot(id, isGot);
    paintGot();
    api.onChange();
  });
  row.addEventListener("click", () => {
    openNow = !openNow;
    body.hidden = !openNow;
    row.setAttribute("aria-expanded", openNow ? "true" : "false");
    wrap.classList.toggle("open", openNow);
  });

  paintGot();
  const line = el("div", { class: "ln" });
  line.appendChild(tick);
  line.appendChild(row);
  wrap.appendChild(line);
  wrap.appendChild(body);
  return wrap;
}
