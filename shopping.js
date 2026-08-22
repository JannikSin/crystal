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

// A bolt row is a DISCLOSURE, not a link. David, 2026-08-18: "I'm seeing Bolt
// has the Stratotech Hoodie Black Heather... but when I click on it, nothing
// pops up. I want there to be something that pops up."
//
// He was right twice over. A row whose payload carried no url rendered as a
// plain div and swallowed the tap entirely, and a row that DID carry one threw
// him out of the app into a browser, which is not "something pops up" either.
// So every row now opens in place, the way the aisle rows already did: the
// facts the agent actually gathered, then the link as a deliberate second tap.
function kv(label, value) {
  const r = el("div", { class: "bkv" });
  r.appendChild(el("span", { class: "k" }, label));
  r.appendChild(el("span", { class: "v" }, md(String(value))));
  return r;
}

/**
 * @param cls      row class, "hit" or "find"
 * @param bits     the collapsed line's spans
 * @param rawUrl   product url, may be missing
 * @param facts    [label, value] pairs for the open state
 * @param why      the agent's reasoning, the thing worth reading
 */
function boltRow(cls, bits, rawUrl, facts, why) {
  const url = safeUrl(rawUrl);
  const wrap = el("div", { class: "brow" });
  const hd = el("button", { type: "button", class: cls + " bhd", "aria-expanded": "false" });
  bits.filter(Boolean).forEach((b) => hd.appendChild(b));
  hd.appendChild(el("span", { class: "car" }, "›"));

  const more = el("div", { class: "bmore" });
  more.hidden = true;
  (facts || []).filter((f) => f && f[1] !== null && f[1] !== undefined && f[1] !== "")
    .forEach((f) => more.appendChild(kv(f[0], f[1])));
  if (why) more.appendChild(el("p", { class: "why" }, md(String(why))));
  if (url) {
    more.appendChild(el("a", { class: "go", href: url, target: "_blank", rel: "noopener" }, "open the product page ↗"));
  } else {
    // Saying so beats a dead-feeling row. This IS the Stratotech case.
    more.appendChild(el("p", { class: "why" }, "The watcher did not record a link for this one, so there is nothing to open. The title above is what it saw."));
  }

  let open = false;
  hd.addEventListener("click", () => {
    open = !open;
    more.hidden = !open;
    hd.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("open", open);
  });
  wrap.appendChild(hd);
  wrap.appendChild(more);
  return wrap;
}

// Collapsed by default. David, 2026-08-19: "if I click a bolt at the top the
// rest needs to be able to disappear, like just be a subcategory... it just
// crowds up this tab too much." The summary keeps the counts, so nothing is
// hidden silently: a quiet week and a week with three finds do not look the
// same from the outside. The last state he chose is remembered.
const BOLT_OPEN = "crystal.boltopen";

function paintBolt(box, d) {
  // Any one half is enough to draw the card. Gating on `built` alone meant a
  // scout digest could not show until the watcher had also reported.
  if (!box.isConnected || !d || !(d.built || d.digestBuilt || d.promoBuilt)) return;
  box.innerHTML = "";

  const week = Array.isArray(d.week) ? d.week : [];
  const dg = d.digest || {};
  const finds = Array.isArray(dg.finds) ? dg.finds : [];
  const promos = Array.isArray(d.promos) ? d.promos : [];
  const sug = Array.isArray(d.suggested) ? d.suggested : [];

  const wrap = el("details", { class: "boltwrap" });
  if (lsGet(BOLT_OPEN, false) === true) wrap.open = true;
  wrap.addEventListener("toggle", () => lsSet(BOLT_OPEN, wrap.open));

  const head = el("summary", { class: "bh" });
  head.appendChild(el("span", { class: "t" }, "⚡ bolt"));
  const age = d.built ? Date.now() - Date.parse(d.built) : NaN;
  const h = Math.floor(age / 3600000);
  head.appendChild(el("span", { class: "age" },
    Number.isNaN(age) ? "watcher has not reported" : age < 0 ? ""
      : h < 1 ? "checked just now" : h < 48 ? `checked ${h}h ago` : "STALE, check the repo"));
  // What is inside, counted, so the collapsed strip is still informative.
  const bits = [];
  if (week.length) bits.push(week.length + (week.length === 1 ? " hit" : " hits"));
  if (finds.length) bits.push(finds.length + (finds.length === 1 ? " find" : " finds"));
  if (promos.length) bits.push(promos.length + " code" + (promos.length === 1 ? "" : "s"));
  if (sug.length) bits.push(sug.length + " to add");
  head.appendChild(el("span", { class: "n" }, bits.length ? bits.join(" · ") : "quiet"));
  wrap.appendChild(head);

  const body = el("div", { class: "bbody" });
  wrap.appendChild(body);
  box.appendChild(wrap);

  body.appendChild(el("div", { class: "watched" }, (d.tracked || 0) + " brands watched"));

  // ---- A: the watcher's week
  if (!week.length) {
    body.appendChild(el("div", { class: "quiet" }, "Quiet week from the watcher. Nothing cleared the bar, which is the plan working."));
  } else {
    week.slice(-6).reverse().forEach((w) => {
      body.appendChild(boltRow("hit", [
        el("span", { class: "d" }, String(w.date || "").slice(5)),
        el("span", { class: "w" }, md(String(w.title || w.key || ""))),
        w.size ? el("span", { class: "sz" }, String(w.size)) : null,
        w.price ? el("span", { class: "p" }, "$" + w.price) : null,
      ], w.url, [
        ["found", w.date || ""],
        // the watcher's key is "Brand:product-slug"; the slug is already the
        // title on the row above, so only the brand half belongs here
        ["brand", w.brand || w.store || String(w.key || "").split(":")[0] || ""],
        ["size", w.size || ""],
        ["price", w.price ? "$" + w.price : ""],
        ["was", w.was ? "$" + w.was : ""],
      ], w.why || w.note));
    });
  }

  // ---- B: the scout's week
  if (dg.headline || finds.length) {
    const sh = el("div", { class: "bsub" });
    sh.appendChild(el("span", { class: "t" }, "scout"));
    if (d.digestBuilt) sh.appendChild(el("span", { class: "age" }, String(d.digestBuilt).slice(0, 10)));
    body.appendChild(sh);
    if (dg.headline) body.appendChild(el("p", { class: "bnote" }, md(String(dg.headline))));
    finds.forEach((f) => {
      const off = (typeof f.price === "number" && typeof f.was === "number" && f.was > 0)
        ? Math.round((1 - f.price / f.was) * 100) + "% off" : "";
      body.appendChild(boltRow("find", [
        el("span", { class: "w" }, md(String(f.title || ""))),
        f.size ? el("span", { class: "sz" }, String(f.size)) : null,
        typeof f.price === "number" ? el("span", { class: "p" }, "$" + f.price.toFixed(2)) : null,
        typeof f.was === "number" ? el("span", { class: "was" }, "$" + f.was.toFixed(0)) : null,
      ], f.url, [
        ["brand", f.brand || f.store || ""],
        ["size", f.size || ""],
        ["price", typeof f.price === "number" ? "$" + f.price.toFixed(2) : ""],
        ["list", typeof f.was === "number" ? "$" + f.was.toFixed(2) : ""],
        ["discount", off],
        ["fabric", f.fabric || f.material || ""],
        ["returns", f.returns || ""],
      ], f.why));
    });
    // The kills are the point, not filler: they are the agent refusing to sell
    // him something, with the rule it applied.
    (Array.isArray(dg.killed) ? dg.killed : []).forEach((k) => {
      body.appendChild(el("div", { class: "killed" },
        md(String(k.title || "")) + (k.why ? " — " + md(String(k.why)) : "")));
    });
    if (dg.uncovered) body.appendChild(el("div", { class: "err" }, md(String(dg.uncovered))));
  }

  // ---- C: promo codes
  if (promos.length) {
    const ph = el("div", { class: "bsub" });
    ph.appendChild(el("span", { class: "t" }, "codes these stores advertise"));
    if (d.promoBuilt) ph.appendChild(el("span", { class: "age" }, String(d.promoBuilt).slice(0, 10)));
    body.appendChild(ph);
    let lastStore = "";
    promos.forEach((c) => {
      // One store heading, then its codes. Repeating the store on every row
      // reads as five stores when it is five codes at one.
      if (c.store !== lastStore) {
        body.appendChild(el("div", { class: "pstore" }, md(String(c.store))));
        lastStore = c.store;
      }
      const r = el("div", { class: "promo" });
      const isStudent = String(c.code) === "STUDENT";
      const code = el("button", { class: isStudent ? "code stu" : "code", type: "button" },
        isStudent ? "student discount" : String(c.code));
      if (!isStudent) {
        // Tap copies. Retyping a code off a phone screen is the friction this
        // whole half exists to remove.
        code.onclick = () => {
          navigator.clipboard?.writeText(String(c.code));
          code.textContent = "copied";
          setTimeout(() => { code.textContent = String(c.code); }, 1200);
        };
      }
      r.appendChild(code);
      // The odds are not decoration. Without them a guess reads as a fact, and
      // these are guesses: nothing short of checkout can verify a Shopify code.
      if (typeof c.odds === "number" && !isStudent) {
        r.appendChild(el("span", { class: "odds" }, c.odds + "% odds"));
      }
      if (c.pct) r.appendChild(el("span", { class: "p" }, "-" + c.pct + "%"));
      body.appendChild(r);
      if (c.why) body.appendChild(el("div", { class: "why" }, md(String(c.why))));
    });
  }

  // ---- D: brands he is suggested to add. Before 2026-08-18 there was nowhere
  // for a suggestion to land: the scout promoted what cleared the bar and
  // everything else vanished into the digest's graveyard.
  if (sug.length) {
    const sh = el("div", { class: "bsub" });
    sh.appendChild(el("span", { class: "t" }, "worth adding, your call"));
    body.appendChild(sh);
    sug.forEach((s) => {
      body.appendChild(boltRow("find", [
        el("span", { class: "w" }, md(String(s.name || ""))),
        s.verdict ? el("span", { class: "sz" }, String(s.verdict)) : null,
      ], s.url, [
        ["verdict", s.verdict || ""],
        ["brand", s.name || ""],
      ], s.why));
    });
  }

  // ---- E: the roster. Collapsed, because it is reference rather than news:
  // he asked to SEE what is followed so he can add to it, not to read 21 rows
  // every time he opens the tab.
  const roster = Array.isArray(d.roster) ? d.roster : [];
  if (roster.length) {
    const live = roster.filter((b) => b.state === "live").length;
    const det = el("details", { class: "rost" });
    const sum = el("summary", {},
      `following ${roster.length} brands, ${live} polled live`);
    det.appendChild(sum);
    roster.forEach((b) => {
      const r = el("div", { class: "brand " + (b.state || "live") });
      r.appendChild(el("span", { class: "w" }, md(String(b.name))));
      r.appendChild(el("span", { class: "st" }, String(b.detail || b.state || "")));
      det.appendChild(r);
    });
    body.appendChild(det);
  }

  if (Array.isArray(d.errors) && d.errors.length) {
    body.appendChild(el("div", { class: "err" }, d.errors.length + " source" + (d.errors.length > 1 ? "s" : "") + " erroring: " + md(String(d.errors[0]).slice(0, 80))));
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
  // FILLING THE CART, second attempt.
  //
  // The first version built the classic multi-ASIN link,
  // https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=...&Quantity.1=1
  // and David reported it plainly: "the link to add all 10 to the Amazon cart
  // just doesn't work. Like literally just doesn't work... I'm logged into my
  // Amazon account, so it should work."
  //
  // Checked against the live site 2026-08-22 and he is right, for a reason no
  // amount of staring at our own code would have found. That URL now 302s to
  // /associates/addtocart and then to an OpenID sign-in carrying
  // assoc_handle=amzn_associates_add_to_cart_us. It is an AFFILIATE endpoint
  // now, not a shopper one: being signed in to Amazon is not enough, it wants
  // an Associates account. There is no query-string URL left that a logged-in
  // shopper can follow to fill a cart with several items.
  //
  // So the control stops pretending. It walks the section one product at a
  // time, which is the number of taps Amazon actually charges, and it says so.
  // The position is held in a closure, not in storage: a shopping section is a
  // few minutes of one person's life, not state worth persisting.
  if (s.status === "buy" || s.status === "queued") {
    const buys = (s.items || []).filter((it) => /amazon\.com\/dp\/[A-Z0-9]{10}/.test(it.url || ""));
    if (buys.length >= 2) {
      let at = 0;
      const btn = el("button", { type: "button", class: "cartall" }, "");
      const paint = () => {
        btn.textContent = at === 0
          ? `open all ${buys.length} on Amazon, one at a time ↗`
          : at < buys.length
            ? `next: ${buys[at].name} · ${at + 1} of ${buys.length} ↗`
            : `all ${buys.length} opened · start over`;
      };
      btn.addEventListener("click", () => {
        if (at >= buys.length) { at = 0; paint(); return; }
        window.open(buys[at].url, "_blank", "noopener");
        at += 1;
        paint();
      });
      paint();
      box.appendChild(btn);
      box.appendChild(el("p", { class: "secnote" },
        "Amazon retired the add-several-at-once link; it now demands an affiliate account rather than yours. One tap per product is what is left."));
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
