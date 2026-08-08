// career.js: CAREER, "the dossier".
//
// Index cards, not a feed. Manila stock, a red rule under the name, typewriter
// facet lines. One company is spotlighted on top of the rolodex; the roster
// below is a stack you flip through, tapping a card to turn it over. The
// outreach slip is the one thing on this tab that ticks.

import {
  root, el, md, blockMd, todayIso, appFooter, emptyState, loadCached, isTab,
} from "./core.js";
import { localTicks, tickControl } from "./sync.js";

const OUTREACH_SECTION = "🤝 One reach-out today";

export function open() {
  loadCached("/career", "crystal.career", render);
}

// a company card can carry several angles; the tap turns the card over
function facetsOf(c) {
  const out = [];
  if (c.facet) out.push([c.facet, c.text || ""]);
  [["Known for", c.knownfor], ["Operating now", c.now], ["In development", c.dev],
   ["Latest", c.update], ["What it is", c.desc]].forEach(([k, v]) => {
    if (v && !out.some((f) => f[1] === v)) out.push([k, v]);
  });
  return out.length ? out : [["", ""]];
}

function render(data, note, empty) {
  if (!isTab("career")) return;
  root.innerHTML = "";
  const head = el("header", { class: "dossier" });
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · career"));
  head.appendChild(el("h1", {}, "The Dossier"));
  if (data && data.date) head.appendChild(el("div", { class: "strap" }, "file of " + md(data.date)));
  root.appendChild(head);

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (empty || !data) {
    root.appendChild(emptyState("🗂", "No dossier yet",
      "The roster and today's name land with the morning build."));
    root.appendChild(appFooter(() => loadCached("/career", "crystal.career", render, true)));
    return;
  }

  if (data.spotlight) root.appendChild(spotCard(data.spotlight));
  if (Array.isArray(data.roster) && data.roster.length) root.appendChild(rolodex(data.roster, data.spotlight));
  if (data.outreach) root.appendChild(outreachSlip(data.outreach));
  if (data.signals) root.appendChild(signalsBlock(data.signals, data.aeroDated));

  root.appendChild(appFooter(() => loadCached("/career", "crystal.career", render, true)));
}

function spotCard(s) {
  const facets = facetsOf(s);
  let i = 0;
  const card = el("section", { class: "spot" });
  card.appendChild(el("div", { class: "tab" }, "today's file" + (s.new ? " · new" : "")));
  card.appendChild(el("h2", {}, md(s.name)));
  card.appendChild(el("div", { class: "rule" }));
  const facet = el("div", { class: "facet" }, md(facets[0][0]));
  const body = el("div", { class: "body" });
  blockMd(body, facets[0][1]);
  card.appendChild(facet);
  card.appendChild(body);
  if (facets.length > 1) {
    const flip = el("button", { type: "button", class: "scanbtn" }, "turn the card");
    flip.addEventListener("click", () => {
      i = (i + 1) % facets.length;
      facet.innerHTML = md(facets[i][0]);
      body.innerHTML = "";
      blockMd(body, facets[i][1]);
    });
    card.appendChild(flip);
  }
  return card;
}

function rolodex(roster, spotlight) {
  const wrap = el("div", { class: "rolodex" });
  roster.forEach((c) => {
    if (spotlight && c.name === spotlight.name) return; // already on top
    const facets = facetsOf(c);
    let i = 0, flipped = false;
    const card = el("button", { type: "button", class: "rcard" });
    const n = el("div", { class: "n" });
    if (typeof c.rank === "number") n.appendChild(el("span", { class: "rk" }, String(c.rank).padStart(2, "0")));
    n.appendChild(el("span", {}, md(c.name)));
    const f = el("div", { class: "f" }, md(facets[0][0]));
    const x = el("div", { class: "x" }, "");
    x.hidden = true;
    card.appendChild(n);
    card.appendChild(f);
    card.appendChild(x);
    card.addEventListener("click", () => {
      if (!flipped) { flipped = true; }
      else { i = (i + 1) % facets.length; if (i === 0) { flipped = false; } }
      f.innerHTML = md(facets[i][0]);
      x.innerHTML = flipped ? md(facets[i][1]) : "";
      x.hidden = !flipped;
    });
    wrap.appendChild(card);
  });
  return wrap;
}

// the one tickable thing on this tab. Same pipe as every other tick, so the
// vault retires the name on the next pull.
function outreachSlip(o) {
  const date = todayIso();
  const local = localTicks(date);
  const entry = local[o.tickId];
  const checked = entry ? !!entry.done : !!o.checked;
  const slip = el("section", { class: "slip" + (checked ? " done" : "") });
  slip.appendChild(el("div", { class: "k" }, "reach out"));
  slip.appendChild(el("h3", {}, md(o.name)));
  const body = el("div", { class: "body" });
  blockMd(body, o.body || "");
  slip.appendChild(body);
  const act = el("div", { class: "act" });
  act.appendChild(tickControl(date, o.tickId, checked, {
    kind: "outreach", section: OUTREACH_SECTION,
    label: o.label || ("Sent to " + o.name), target: o.target || o.name,
  }, (on) => slip.classList.toggle("done", on)));
  act.appendChild(el("span", { class: "lbl" }, md(o.label || ("Sent to " + o.name))));
  if (typeof o.contacted === "number" && o.contacted > 0) {
    act.appendChild(el("span", { class: "badge" }, o.contacted + " contacted"));
  }
  slip.appendChild(act);
  return slip;
}

function signalsBlock(s, aeroDated) {
  const box = el("section", { class: "signals" });
  box.appendChild(el("div", { class: "sh" },
    "aerospace signals" + (s.date ? " · " + md(s.date) : "") + (s.suffix ? " " + md(s.suffix) : "")));
  (s.items || []).forEach((t) => {
    const item = el("div", { class: "item" });
    blockMd(item, t);
    box.appendChild(item);
  });
  if (aeroDated) box.appendChild(el("p", { class: "moneyfoot" }, md(aeroDated)));
  return box;
}
