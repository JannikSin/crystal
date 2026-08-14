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

function sectionBlock(s, rows) {
  const meta = STATUS[s.status] || STATUS.queued;
  const box = el("section", { class: "aislesec " + meta.cls });
  const h = el("div", { class: "sh" });
  h.appendChild(el("span", { class: "t" }, md(s.title)));
  h.appendChild(el("span", { class: "chip" }, meta.chip));
  box.appendChild(h);
  if (s.note) box.appendChild(el("p", { class: "secnote" }, md(s.note)));
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
