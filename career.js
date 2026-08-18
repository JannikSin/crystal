// career.js: CAREER, "the spec sheet".
//
// An engineering drawing, not a rolodex. Hairline rules, mono title-block
// micro-labels, a faint blueprint grid behind today's file and nowhere else,
// and one accent: violet. The roster is a flat spec list, a rank in a fixed
// mono column and the name in serif, tapping a row to cycle its facet. The
// work order at the foot is the one thing on this tab that ticks.

import {
  root, el, md, blockMd, todayIso, appFooter, emptyState, loadCached, isTab,
} from "./core.js";
import { localTicks, tickControl } from "./sync.js";

const OUTREACH_SECTION = "🤝 One reach-out today";

export function open() {
  loadCached("/career", "crystal.career", render);
}

// a company can carry several angles; the tap turns it to the next one
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
  head.appendChild(el("h1", {}, "The Spec Sheet"));
  if (data && data.date) head.appendChild(el("div", { class: "strap" }, "file of " + md(data.date)));
  root.appendChild(head);

  if (note) root.appendChild(el("div", { class: "banner" }, note));

  if (empty || !data) {
    root.appendChild(emptyState("📐", "No sheet yet",
      "The roster and today's name land with the morning build."));
    root.appendChild(appFooter(() => loadCached("/career", "crystal.career", render, true)));
    return;
  }

  if (data.spotlight) root.appendChild(spotCard(data.spotlight));
  if (Array.isArray(data.roster) && data.roster.length) root.appendChild(specList(data.roster, data.spotlight));
  if (data.outreach) root.appendChild(outreachSlip(data.outreach));
  if (Array.isArray(data.tracker)) root.appendChild(trackerBlock(data.tracker));
  if (data.signals) root.appendChild(signalsBlock(data.signals));

  // Interview reps: recording lives on the Today board (accessible where the
  // day is), the GRADES live here, because grading is interview prep (David,
  // 2026-08-16). /reps is the permanent archive, every graded rep ever; the
  // 14-day per-date feedback keys only feed the transient recorder note.
  const repsBox = el("section", { class: "repslist" });
  root.appendChild(repsBox);
  loadCached("/reps", "crystal.reps", (r) => paintReps(repsBox, r));

  root.appendChild(appFooter(() => loadCached("/career", "crystal.career", render, true)));
}

function paintReps(box, r) {
  if (!box.isConnected) return;
  box.innerHTML = "";
  box.appendChild(el("div", { class: "sh" }, "🧠 interview reps · graded"));
  const items = (r && Array.isArray(r.items)) ? r.items : [];
  if (!items.length) {
    box.appendChild(el("p", { class: "secnote" },
      "No graded reps yet. Record on the Today board; grades land here with the 6:30 morning build."));
    return;
  }
  items.forEach((it) => {
    const wrap = el("div", { class: "rep" });
    const head = el("button", { type: "button", class: "hd", "aria-expanded": "false" });
    head.appendChild(el("span", { class: "d" }, md(String(it.date || "").slice(5))));
    head.appendChild(el("span", { class: "q" }, md(String(it.q || it.qid || "").slice(0, 80))));
    head.appendChild(el("span", { class: "car" }, "›"));
    const body = el("div", { class: "more" });
    body.hidden = true;
    if (it.q) body.appendChild(el("p", { class: "qfull" }, md(it.q)));
    if (it.transcriptExcerpt) body.appendChild(el("blockquote", {}, md(it.transcriptExcerpt)));
    if (it.grade != null) body.appendChild(el("p", { class: "grade" }, md("Grade: " + it.grade)));
    if (it.workshop) blockMd(body, it.workshop);
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
      head.setAttribute("aria-expanded", body.hidden ? "false" : "true");
      wrap.classList.toggle("open", !body.hidden);
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    box.appendChild(wrap);
  });
}

// the one card with the blueprint grid behind it. Everything else on the tab
// is flat, so the grid alone says "this is the sheet you are reading today".
function spotCard(s) {
  const facets = facetsOf(s);
  let i = 0;
  const card = el("section", { class: "spot" });
  const tb = el("div", { class: "tb" });
  tb.appendChild(el("span", {}, "today's file"));
  if (s.new) tb.appendChild(el("span", { class: "rev" }, "new"));
  card.appendChild(tb);
  card.appendChild(el("h2", {}, md(s.name)));
  card.appendChild(el("div", { class: "rule" }));
  const facet = el("div", { class: "facet" }, md(facets[0][0]));
  const body = el("div", { class: "body" });
  blockMd(body, facets[0][1]);
  card.appendChild(facet);
  card.appendChild(body);
  if (facets.length > 1) {
    const flip = el("button", { type: "button", class: "turn" }, "next view");
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

// the roster as a spec list: rank in a fixed mono column, name in serif, the
// facet label to the right, the facet text below once the row is open
function specList(roster, spotlight) {
  const wrap = el("div", { class: "spec" });
  wrap.appendChild(el("div", { class: "sh" }, "roster · rank / name / view"));
  roster.forEach((c) => {
    if (spotlight && c.name === spotlight.name) return; // already on the sheet
    const facets = facetsOf(c);
    let i = 0, open = false;
    const row = el("button", { type: "button", class: "specrow" });
    row.appendChild(el("span", { class: "rk" },
      typeof c.rank === "number" ? String(c.rank).padStart(2, "0") : "--"));
    row.appendChild(el("span", { class: "nm" }, md(c.name)));
    const f = el("span", { class: "f" }, md(facets[0][0]));
    const x = el("span", { class: "x" }, "");
    x.hidden = true;
    row.appendChild(f);
    row.appendChild(x);
    row.addEventListener("click", () => {
      if (!open) { open = true; }
      else { i = (i + 1) % facets.length; if (i === 0) { open = false; } }
      f.innerHTML = md(facets[i][0]);
      x.innerHTML = open ? md(facets[i][1]) : "";
      x.hidden = !open;
    });
    wrap.appendChild(row);
  });
  return wrap;
}

// A contact the vault already knows: one tap opens the message instead of
// sending him hunting for the number. Only these three schemes are ever built,
// so a crafted "contact" cannot become a javascript: link.
function contactHref(c) {
  const v = String(c || "").trim();
  if (/^https:\/\/[^\s"'<>`]+$/.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "mailto:" + v;
  if (/^\+?[\d\-(). ]{7,20}$/.test(v)) return "sms:" + v.replace(/[^\d+]/g, "");
  return "";
}

// the one tickable thing on this tab, drawn as a work order. Same pipe as
// every other tick, so the vault retires the name on the next pull.
function outreachSlip(o) {
  const date = todayIso();
  const local = localTicks(date);
  const entry = local[o.tickId];
  const checked = entry ? !!entry.done : !!o.checked;
  const slip = el("section", { class: "slip" + (checked ? " done" : "") });
  const k = el("div", { class: "k" });
  k.appendChild(el("span", {}, "work order"));
  k.appendChild(el("span", { class: "no" }, "one reach-out"));
  slip.appendChild(k);
  const inner = el("div", { class: "in" });
  inner.appendChild(el("h3", {}, md(o.name)));
  const body = el("div", { class: "body" });
  blockMd(body, o.body || "");
  inner.appendChild(body);
  const act = el("div", { class: "act" });
  act.appendChild(tickControl(date, o.tickId, checked, {
    kind: "outreach", section: OUTREACH_SECTION,
    label: o.label || ("Sent to " + o.name), target: o.target || o.name,
  }, (on) => slip.classList.toggle("done", on)));
  act.appendChild(el("span", { class: "lbl" }, md(o.label || ("Sent to " + o.name))));
  if (typeof o.contacted === "number" && o.contacted > 0) {
    act.appendChild(el("span", { class: "badge" }, o.contacted + " contacted"));
  }
  const href = contactHref(o.contact);
  if (href) {
    act.appendChild(el("a", { class: "go", href, target: "_blank", rel: "noopener" },
      href.indexOf("sms:") === 0 ? "text ↗" : href.indexOf("mailto:") === 0 ? "email ↗" : "open ↗"));
  }
  inner.appendChild(act);
  slip.appendChild(inner);
  return slip;
}

// the outreach tracker: every queued draft and sent-and-waiting row from the
// vault's System/Outreach-Tracker.md, one place to see everything in flight
// rather than opening Gmail Drafts and the vault separately (David, 2026-08-17)
function trackerBlock(rows) {
  const box = el("section", { class: "tracker" });
  box.appendChild(el("div", { class: "sh" }, "outreach tracker · queue & waiting"));
  if (!rows.length) {
    box.appendChild(el("p", { class: "secnote" }, "Nothing queued or waiting right now."));
    return box;
  }
  rows.forEach((r) => {
    const row = el("div", { class: "trow" });
    const top = el("div", { class: "trtop" });
    top.appendChild(el("span", { class: "trwho" },
      md([r.to, r.org].filter(Boolean).join(" · "))));
    if (r.status) top.appendChild(el("span", { class: "badge" + (r.kind ? " " + r.kind : "") }, md(r.status)));
    row.appendChild(top);
    if (r.ask) row.appendChild(el("div", { class: "trask" }, md(r.ask)));
    const foot = el("div", { class: "trfoot" });
    if (r.due) foot.appendChild(el("span", {}, "due " + md(r.due)));
    if (r.action) foot.appendChild(el("span", { class: "tract" }, md(r.action)));
    if (foot.childNodes.length) row.appendChild(foot);
    box.appendChild(row);
  });
  return box;
}

function signalsBlock(s) {
  const box = el("section", { class: "signals" });
  box.appendChild(el("div", { class: "sh" },
    "aerospace signals" + (s.date ? " · " + md(s.date) : "") + (s.suffix ? " " + md(s.suffix) : "")));
  (s.items || []).forEach((t) => {
    const item = el("div", { class: "item" });
    blockMd(item, t);
    box.appendChild(item);
  });
  // the sweep's own caveat about how old the reading is
  if (s.note) box.appendChild(el("p", { class: "moneyfoot" }, md(s.note)));
  return box;
}
