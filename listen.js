// listen.js: LISTEN, "the walkman".
//
// A media queue, not a list of links. Big rounded rows, emoji tag chips, a
// length badge, a filter row that actually filters, and the history tape
// underneath. Ticking a row is the same /ticks delta the Today pointer uses
// (kind "listen", target the episode id), so one act makes one record and two
// surfaces render it.

import {
  root, el, md, lsGet, lsSet, todayIso, appFooter, emptyState, loadCached, isTab,
} from "./core.js";
import { localTicks, tickControl, queueCapture } from "./sync.js";

const SECTION = "🎧 Listen";
const TAG_EMOJI = {
  aero: "🚀", tech: "⚙️", physics: "⚛️", history: "📜", news: "📰",
  audiobook: "📚", reading: "📖", music: "🎵",
};
const TAGS = ["aero", "tech", "physics", "history", "news", "audiobook"];

export function open() {
  loadCached("/listen", "crystal.listen", render);
}

const reload = () => loadCached("/listen", "crystal.listen", render, true);

function minutesOf(it) {
  if (typeof it.minutes === "number") return it.minutes;
  const s = String(it.length || "");
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const m = s.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) : null;
}

function render(data, note, empty) {
  if (!isTab("listen")) return;
  root.innerHTML = "";
  const head = el("header", {});
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · listen"));
  head.appendChild(el("h1", {}, "The Walkman"));
  root.appendChild(head);

  if (note) root.appendChild(el("div", { class: "banner" }, note));
  if (empty || !data) {
    root.appendChild(emptyState("🎧", "No queue yet",
      "The queue syncs from the vault with the morning build."));
    root.appendChild(appFooter(reload));
    return;
  }

  const mode = lsGet("crystal.listenMode", "podcast");
  const sw = el("div", { class: "wswitch", role: "tablist", "aria-label": "Mode" });
  [["podcast", "podcasts"], ["music", "music"]].forEach(([k, label]) => {
    const b = el("button", { type: "button", "aria-current": k === mode ? "true" : "false" }, label);
    b.addEventListener("click", () => { lsSet("crystal.listenMode", k); render(data, ""); });
    sw.appendChild(b);
  });
  root.appendChild(sw);

  if (mode === "music") { musicMode(data); root.appendChild(appFooter(reload)); return; }

  const date = todayIso();
  const local = localTicks(date);
  const queue = (data.queue || []).filter((q) => q.kind !== "music");
  const listened = (id) => !!(local[id] && local[id].done);

  // ---- filters ----
  const active = lsGet("crystal.listenFilters", []);
  const filters = el("div", { class: "filters" });
  TAGS.concat(["<1h", "long"]).forEach((f) => {
    const on = active.indexOf(f) >= 0;
    const b = el("button", { type: "button", "aria-pressed": on ? "true" : "false" },
      (TAG_EMOJI[f] ? TAG_EMOJI[f] + " " : "") + f);
    b.addEventListener("click", () => {
      const next = on ? active.filter((x) => x !== f) : active.concat([f]);
      lsSet("crystal.listenFilters", next);
      render(data, "");
    });
    filters.appendChild(b);
  });
  root.appendChild(filters);

  // Tags are alternatives (aero OR history), length is a constraint on top of
  // them. Two tags ANDed together matched nothing, which read as a broken chip.
  const isDur = (f) => f === "<1h" || f === "long";
  const tagsOn = active.filter((f) => !isDur(f));
  const durOn = active.filter(isDur);
  const passes = (it) =>
    (!tagsOn.length || tagsOn.some((f) => (it.tags || []).indexOf(f) >= 0)) &&
    durOn.every((f) => {
      const m = minutesOf(it);
      return m !== null && (f === "<1h" ? m < 60 : m >= 60);
    });

  const live = queue.filter((q) => !listened(q.id) && passes(q));
  const list = el("div", {});
  if (!live.length) {
    list.appendChild(el("p", { class: "empty" },
      queue.length ? "Nothing left under these filters." : "The queue is empty. Run the sweep."));
  }
  live.forEach((it) => list.appendChild(queueRow(date, it)));
  root.appendChild(list);

  const find = el("button", { type: "button", class: "findmore" }, "Find more");
  find.addEventListener("click", () => {
    queueCapture("run the podcast sweep");
    find.textContent = "Filed. The sweep runs next session.";
    find.disabled = true;
  });
  root.appendChild(find);

  // ---- history tape ----
  const past = queue.filter((q) => listened(q.id))
    .map((q) => ({ id: q.id, title: q.title, date: (local[q.id] || {}).at || date }))
    .concat(data.history || []);
  const tape = el("details", { class: "tape" });
  tape.appendChild(el("summary", {}, "history · " + past.length));
  // the tape only grows, so finding "that Acquired one" needs a text box
  const find = el("input", { class: "hfind", type: "search", placeholder: "filter the tape",
    "aria-label": "Filter history" });
  const rows = el("div", {});
  const paintTape = () => {
    const q = find.value.trim().toLowerCase();
    rows.innerHTML = "";
    past
      .filter((h) => !q || String(h.title || h.id || "").toLowerCase().indexOf(q) >= 0)
      .forEach((h) => {
        const row = el("div", { class: "hrow" });
        const when = String(h.date || h.at || "").slice(0, 10);
        if (when) row.appendChild(el("span", { class: "d" }, md(when)));
        row.appendChild(el("span", {}, md(h.title || h.id)));
        rows.appendChild(row);
      });
  };
  find.addEventListener("input", paintTape);
  tape.appendChild(find);
  tape.appendChild(rows);
  paintTape();
  root.appendChild(tape);

  if (data.audiobook) root.appendChild(audiobookCard(data.audiobook, data.activities));
  root.appendChild(appFooter(reload));
}

function queueRow(date, it) {
  const row = el("article", { class: "qrow" });
  row.appendChild(tickControl(date, it.id, false, {
    kind: "listen", section: SECTION, label: it.title, target: it.id,
  }, () => {
    row.classList.add("gone");
    setTimeout(() => row.remove(), 320);
  }));
  const meta = el("div", { class: "meta" });
  const tags = el("div", { class: "tags" });
  (it.tags || []).forEach((t) => tags.appendChild(el("span", {}, (TAG_EMOJI[t] || "•") + " " + md(t))));
  if (it.length) tags.appendChild(el("span", { class: "len" }, md(String(it.length))));
  meta.appendChild(tags);
  meta.appendChild(el("h3", {}, md(it.title)));
  if (it.note) meta.appendChild(el("p", { class: "note" }, md(it.note)));
  if (it.link) {
    const a = el("a", { class: "go", href: it.link, target: "_blank", rel: "noopener" }, "open ↗");
    meta.appendChild(a);
  }
  row.appendChild(meta);
  return row;
}

function musicMode(data) {
  const box = el("div", {});
  box.appendChild(el("p", { class: "empty" },
    "Music is for the blocks where a podcast would cost you the thinking."));
  (data.music || []).forEach((m) => {
    const row = el("article", { class: "qrow" });
    const meta = el("div", { class: "meta" });
    meta.appendChild(el("div", { class: "tags" }, "🎵 playlist"));
    meta.appendChild(el("h3", {}, md(m.label)));
    if (m.link) meta.appendChild(el("a", { class: "go", href: m.link, target: "_blank", rel: "noopener" }, "open ↗"));
    row.appendChild(meta);
    box.appendChild(row);
  });
  if (!(data.music || []).length) {
    box.appendChild(el("p", { class: "empty" }, "No playlists in the payload yet."));
  }
  root.appendChild(box);
}

function audiobookCard(a, activities) {
  const box = el("section", { class: "abook" });
  box.appendChild(el("h3", {}, md(a.current)));
  const where = (a.where || []).map((w) => (typeof w === "string" ? w : w.label));
  if (where.length) box.appendChild(el("div", { class: "ord" }, where.map(md).join("  →  ")));
  (a.where || []).forEach((w) => {
    if (typeof w === "string" || !w.note) return;
    box.appendChild(el("div", { class: "w" }, "<b>" + md(w.label) + "</b> " + md(w.note)));
  });
  const acts = (a.activities || activities || []);
  if (acts.length) {
    const row = el("div", { class: "acts" });
    acts.forEach((t) => row.appendChild(el("span", { class: "badge violet" }, md(t))));
    box.appendChild(row);
  }
  return box;
}
