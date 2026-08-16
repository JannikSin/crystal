// news.js: NEWS, "the dispatch".
//
// A newspaper front page: one story per category by rank, then ranked batches
// of five behind a reveal. Serif mastheads, no cards, rules between stories.
// Honesty rule (v4): a degraded edition never shows a number. If the compile
// did not actually evaluate the sources, the chip says "unscored" in grey.

import {
  root, api, el, md, lsGet, lsSet, go, fmtDay, fmtBuilt, mastHead, appFooter, emptyState, isTab,
} from "./core.js";
import { readSetOf, markRead } from "./sync.js";

let news = null;
// scroll offset of the front page when a story was opened, so the back
// button lands where you were, not at the top
let listScroll = 0;

const CAT_ORDER = ["ai", "aero", "world", "energy", "sports"];
const CAT_LABEL = {
  ai: "AI / Tech", aero: "Aerospace / Defense", world: "World / Politics",
  energy: "Energy / Nuclear", sports: "Sports",
};
function catKey(cat) {
  const c = String(cat || "").toLowerCase();
  if (/aero|defen|space/.test(c)) return "aero";
  if (/ai|tech/.test(c)) return "ai";
  if (/world|politic|geo/.test(c)) return "world";
  if (/energy|nuclear|power/.test(c)) return "energy";
  if (/sport/.test(c)) return "sports";
  return c;
}
// the fallback is payload text landing in innerHTML, so it escapes like
// everything else the Worker returns
const catLabel = (cat) => CAT_LABEL[catKey(cat)] || md(String(cat));

const NEWS_CAP = 20;

// A score is only real when the compile actually evaluated the sources. The
// placeholder prefix is written by news_compile.py in degraded mode.
function scored(story, edition) {
  if (edition && edition.mode === "degraded") return false;
  const why = (story.scoreDetail && story.scoreDetail.reasoning) || "";
  return !/^AI-estimated: placeholder/.test(why);
}

// batch 0 = front page, one per category by rank; then ranked chunks of 5
function newsBatches(stories) {
  const sorted = stories.slice().sort((a, b) => a.rank - b.rank);
  const used = {};
  const front = [];
  CAT_ORDER.forEach((c) => {
    for (let i = 0; i < sorted.length; i++) {
      if (!used[sorted[i].id] && catKey(sorted[i].cat) === c) {
        front.push(sorted[i]); used[sorted[i].id] = true; return;
      }
    }
  });
  for (let i = 0; i < sorted.length && front.length < 5; i++) {
    if (!used[sorted[i].id]) { front.push(sorted[i]); used[sorted[i].id] = true; }
  }
  const rest = sorted.filter((s) => !used[s.id]);
  const batches = front.length ? [front] : [];
  while (rest.length) batches.push(rest.splice(0, 5));
  return batches;
}

export function open(parts) {
  if (parts && parts[1]) { openStory(parts[1]); return; }
  load(false);
}

function load(force) {
  const cached = lsGet("crystal.news.last", null);
  if (cached && !force) { news = cached; renderNews(""); }
  api("/news")
    .then((data) => {
      news = data;
      lsSet("crystal.news.last", data);
      api("/newsread?date=" + data.date).then((r) => {
        if (r.ids && r.ids.length) {
          const cur = readSetOf(data.date);
          const have = new Set(cur);
          lsSet("crystal.read." + data.date, cur.concat(r.ids.filter((i) => !have.has(i))));
        }
        if (!location.hash.match(/#\/news\/./)) renderNews("");
      }).catch(() => {});
      if (!location.hash.match(/#\/news\/./)) renderNews("");
    })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { news = null; renderNews("", true); return; }
      if (cached) { news = cached; renderNews("Offline. Showing the cached edition."); }
      else renderNews("", true);
    });
}

function renderNews(offlineNote, noEdition) {
  if (!isTab("news")) return;
  root.innerHTML = "";
  const sub = news ? fmtDay(news.date) + (news.built ? " · " + fmtBuilt(news.built) : "") : "";
  root.appendChild(mastHead("news", "The Dispatch", sub));

  if (offlineNote) root.appendChild(el("div", { class: "banner" }, offlineNote));
  if (news && news.mode === "degraded") {
    root.appendChild(el("div", { class: "banner" },
      "Degraded edition: the compile could not read the sources, so nothing here carries a score."));
  }

  if (noEdition || !news) {
    root.appendChild(emptyState("🗞", "No edition yet",
      "The news desk publishes with the morning build. Nothing has been pushed."));
    root.appendChild(appFooter(() => load(true)));
    return;
  }

  const date = news.date;
  const read = new Set(readSetOf(date));
  const batches = newsBatches(news.stories || []);
  let shownBatches = Math.max(1, lsGet("crystal.newsbatch." + date, 1));

  const totalStories = (news.stories || []).length;
  let capBatches = 1;
  let count = batches.length ? batches[0].length : 0;
  for (let i = 1; i < batches.length; i++) {
    if (count + batches[i].length > NEWS_CAP) break;
    count += batches[i].length;
    capBatches++;
  }
  shownBatches = Math.min(shownBatches, capBatches);

  const list = el("div", {});
  const visibleIds = [];
  for (let b = 0; b < shownBatches && b < batches.length; b++) {
    if (b > 0) list.appendChild(el("div", { class: "batchrule" }, "more of the day"));
    batches[b].forEach((s) => {
      visibleIds.push(s.id);
      const item = el("article", { class: "fp" + (read.has(s.id) ? " read" : ""), role: "button", tabindex: "0" });
      item.appendChild(el("div", { class: "cat" },
        catLabel(s.cat) + (read.has(s.id) ? '<span class="rmark">✓ read</span>' : "")));
      item.appendChild(el("h3", {}, md(s.headline)));
      item.appendChild(el("p", { class: "one" }, md(s.oneLiner)));
      const openIt = () => { listScroll = window.scrollY; go("#/news/" + encodeURIComponent(s.id)); };
      item.addEventListener("click", openIt);
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") openIt(); });
      list.appendChild(item);
    });
  }
  root.appendChild(list);

  const remaining = totalStories - visibleIds.length;
  const canReveal = shownBatches < capBatches;
  if (canReveal) {
    const more = el("button", { type: "button", class: "morebtn" }, "Read 5 more ↓");
    more.addEventListener("click", () => {
      // read = opened the story, nothing else; revealing a batch marks nothing
      lsSet("crystal.newsbatch." + date, shownBatches + 1);
      renderNews("");
    });
    root.appendChild(more);
  }
  const notShown = (news.notShownCount || 0) + (canReveal ? 0 : remaining);
  if (!canReveal && notShown > 0) {
    root.appendChild(el("p", { class: "notshown" },
      notShown + " more stor" + (notShown === 1 ? "y" : "ies") + " ranked below the cut, not shown."));
  } else if (canReveal && news.notShownCount > 0) {
    root.appendChild(el("p", { class: "notshown" },
      news.notShownCount + " more beyond the edition, not shown."));
  }

  root.appendChild(appFooter(() => load(true)));
  window.scrollTo(0, listScroll);
}

function openStory(id) {
  if (!news) {
    const cached = lsGet("crystal.news.last", null);
    if (cached) news = cached;
    else {
      api("/news").then((data) => { news = data; lsSet("crystal.news.last", data); openStory(id); })
        .catch(() => go("#/news"));
      return;
    }
  }
  const story = (news.stories || []).find((s) => s.id === id);
  if (!story) { go("#/news"); return; }
  markRead(news.date, [id]);
  renderStory(story);
}

// reliability traffic light: David glances at the color, reads red with care
const relClass = (r) => (r >= 75 ? "rgreen" : r >= 50 ? "ryellow" : "rred");

function renderStory(s) {
  if (!isTab("news")) return;
  root.innerHTML = "";
  window.scrollTo(0, 0);
  const back = el("button", { type: "button", class: "backbtn" }, "← the dispatch");
  back.addEventListener("click", () => go("#/news"));
  root.appendChild(back);

  const art = el("article", { class: "art" });
  art.appendChild(el("div", { class: "eyebrow" }, catLabel(s.cat)));
  art.appendChild(el("h2", {}, md(s.headline)));
  art.appendChild(el("p", { class: "one" }, md(s.oneLiner)));

  const isScored = scored(s, news);
  const rel = isScored && s.scoreDetail && s.scoreDetail.reliability != null
    ? Number(s.scoreDetail.reliability) : null;
  const chipRow = el("div", { style: "margin:10px 0 2px" });
  const chip = isScored
    ? el("button", { type: "button", class: "scorechip", "aria-expanded": "false" },
        (rel != null ? '<span class="reldot ' + relClass(rel) + '"></span>' : "")
        + '<span class="v">' + Number(s.score) + '</span><span class="cap">/ 100 · tap for the working</span>')
    : el("button", { type: "button", class: "scorechip unscored", "aria-expanded": "false" },
        '<span class="v">unscored</span><span class="cap">no evaluation ran · tap</span>');
  chipRow.appendChild(chip);
  art.appendChild(chipRow);

  const subs = el("div", { class: "subscores", hidden: "" });
  const d = s.scoreDetail || {};
  if (isScored) {
    // The big number is information quality (sourcing, corroboration), never
    // personal relevance: David's 2026-08-16 rule, relevance lives in
    // selection and rank only. Reliability and charge are independent
    // read-with-care meters: each row names its direction, and charge's tone
    // is INVERTED (low charge = calm framing = green).
    [["Reliability", d.reliability, "rel", "higher = better sourced"],
     ["Charge", d.charge, "chg", "how heated the framing is; low = calm, high = read with care"],
    ].forEach((row) => {
      const v = row[1] != null ? Number(row[1]) : null;
      const tone = v == null ? "" : row[2] === "rel" ? relClass(v) : relClass(100 - v);
      const sub = el("div", { class: "sub" });
      sub.appendChild(el("div", { class: "subhead" },
        "<span>" + row[0] + "</span><b class=\"" + tone + "\">" + (v != null ? v : "--") + "</b>"));
      sub.appendChild(el("div", { class: "bar " + row[2] },
        '<i class="' + tone + '" style="width:' + (v || 0) + '%"></i>'));
      sub.appendChild(el("div", { class: "subcap" }, row[3]));
      subs.appendChild(sub);
    });
    subs.appendChild(el("p", { class: "reason legend" },
      "The big number is how solid the information is: sourcing, corroboration, verification. Never tailored to you or your lanes; which stories appear and their order is where relevance lives."));
    if (d.reasoning) subs.appendChild(el("p", { class: "reason" }, md(d.reasoning)));
    subs.appendChild(el("div", { class: "aiest" }, "AI-estimated, not a fact"));
  } else {
    subs.appendChild(el("p", { class: "reason" },
      "This edition was built without an evaluation pass, so there is no reliability or charge reading to show. Read the sources below on their own terms."));
  }
  art.appendChild(subs);
  chip.addEventListener("click", () => {
    const opening = subs.hasAttribute("hidden");
    if (opening) subs.removeAttribute("hidden"); else subs.setAttribute("hidden", "");
    chip.setAttribute("aria-expanded", opening ? "true" : "false");
  });

  if (s.facts && s.facts.length) {
    art.appendChild(el("h4", {}, "What happened"));
    const ul = el("ul", {});
    s.facts.forEach((f) => ul.appendChild(el("li", {}, md(f))));
    art.appendChild(ul);
  }
  if (s.context) { art.appendChild(el("h4", {}, "Context")); art.appendChild(el("p", {}, md(s.context))); }
  if (s.whyItMatters) {
    art.appendChild(el("h4", {}, "Why it matters to you"));
    art.appendChild(el("div", { class: "why" }, md(s.whyItMatters)));
  }
  if (s.contested) {
    const con = el("div", { class: "contested" });
    con.appendChild(el("h5", {}, "Contested: fact vs readings"));
    con.appendChild(el("div", {}, "The facts above are agreed. What they mean is not:"));
    const cul = el("ul", {});
    (s.interpretations || []).forEach((t) => cul.appendChild(el("li", {}, md(t))));
    con.appendChild(cul);
    art.appendChild(con);
  }

  art.appendChild(el("h4", {}, "Sources"));
  const panel = el("div", { class: "srcpanel" });
  const badges = el("div", { class: "chips" });
  badges.appendChild(el("span", { class: "badge violet" },
    "seen in " + Number(s.sourceCount) + " source" + (s.sourceCount === 1 ? "" : "s")));
  if (s.crossSector) badges.appendChild(el("span", { class: "badge gold" }, "cross-sector"));
  (s.tickerTags || []).forEach((t) => badges.appendChild(el("span", { class: "badge" }, "$" + md(t))));
  panel.appendChild(badges);
  (s.sources || []).forEach((src) => {
    const row = el("div", { class: "src" });
    row.appendChild(el("b", {}, md(src.name)));
    if (src.note) row.appendChild(el("span", {}, md(src.note)));
    panel.appendChild(row);
  });
  art.appendChild(panel);

  root.appendChild(art);
  root.appendChild(appFooter(() => { load(true); go("#/news"); }));
}

// the money tab borrows the cached edition to show related stories
export const cachedEdition = () => news || lsGet("crystal.news.last", null);
