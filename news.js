// news.js: NEWS, "The Crystal" (teide, 2026-11-25; replaces "the dispatch").
//
// A newspaper with an end. The front page is a photo lead and a grid of photo cards, the long read, and
// "You're caught up" with his first item from Today. Nothing loads after it.
// Sections swipe sideways; a story opens on its own route (#/news/<id>) and a
// swipe right or the back button returns to the same scroll spot.
//
// Stories read as narrative (deck + body paragraphs, David 2026-11-25: "i like
// narative... lets keep it that way"). No lists anywhere in a story (David,
// 2026-11-25 11:15 pm: "in paragraph form to avoid repetition"): the compile
// gives every story a body, and an old edition without one is set as
// paragraphs from its facts here. The fold says only what the body does not.
//
// Photos come from the Worker (/newsimg), fetched with the key and shown from
// a blob URL; img-src never reaches a third-party host. Cached in Cache
// Storage per date so the paper opens offline.
//
// Honesty rule (v4) stands: a degraded edition never shows a number.

import {
  root, api, el, md, lsGet, lsSet, go, fmtDay, appFooter, emptyState, isTab, key, WORKER, todayIso,
} from "./core.js";
import { readSetOf, markRead, queueDesk, localTicks, isDone } from "./sync.js";
import { episodeCard, playingShelf } from "./episode.js";
import { bodyParas } from "./prose.js";

let news = null;
let listScroll = 0;

const SECTIONS = [
  { k: "front", label: "Front page" },
  { k: "world", label: "World" },
  { k: "ai", label: "AI and Tech" },
  { k: "aero", label: "Aerospace" },
  { k: "energy", label: "Energy" },
  { k: "science", label: "Science" },
  { k: "markets", label: "Markets" },
  { k: "purdue", label: "Purdue" },
  { k: "sports", label: "Sports" },
];
const CAT_LABEL = {
  ai: "AI and Tech", aero: "Aerospace and Defense", world: "World and Politics",
  energy: "Energy and Nuclear", sports: "Sports",
  science: "Science", markets: "Business and Markets", purdue: "Purdue and Indiana",
};
function catKey(cat) {
  const c = String(cat || "").toLowerCase();
  if (/purdue|indiana/.test(c)) return "purdue";
  if (/business|market/.test(c)) return "markets";
  if (/^science/.test(c)) return "science";
  if (/aero|defen|space/.test(c)) return "aero";
  if (/ai|tech/.test(c)) return "ai";
  if (/world|politic|geo/.test(c)) return "world";
  if (/energy|nuclear|power/.test(c)) return "energy";
  if (/sport/.test(c)) return "sports";
  return "world";
}
const catLabel = (cat) => CAT_LABEL[catKey(cat)] || md(String(cat));
const esc = (s) => md(String(s == null ? "" : s)); // md escapes first; see core.js

function scored(story, edition) {
  if (edition && edition.mode === "degraded") return false;
  const why = (story.scoreDetail && story.scoreDetail.reasoning) || "";
  return !/^AI-estimated: placeholder/.test(why);
}
const ordered = () => (news && news.stories ? news.stories.slice().sort((a, b) => a.rank - b.rank) : []);

// ---------------------------------------------------------------- photos
const IMG_CACHE = "crystal-newsimg-v1";
const blobs = new Map();
const imgUrl = (date, id) => WORKER + "/newsimg?date=" + date + "&id=" + encodeURIComponent(id);

async function photo(date, id) {
  const u = imgUrl(date, id);
  if (blobs.has(u)) return blobs.get(u);
  const p = (async () => {
    let res = null;
    const cache = self.caches ? await caches.open(IMG_CACHE).catch(() => null) : null;
    if (cache) res = await cache.match(u).catch(() => null);
    if (!res) {
      res = await fetch(u, { headers: { "x-brief-key": key() } });
      if (!res.ok) throw new Error("http " + res.status);
      if (cache) cache.put(u, res.clone()).catch(() => {});
    }
    return URL.createObjectURL(await res.blob());
  })();
  blobs.set(u, p);
  p.catch(() => blobs.delete(u));
  return p;
}

// drop photos from other days so the cache never grows past one edition
function prunePhotos(date) {
  if (!self.caches) return;
  caches.open(IMG_CACHE).then((c) => c.keys().then((ks) => ks.forEach((r) => {
    if (!r.url.includes("date=" + date + "&")) c.delete(r);
  }))).catch(() => {});
}

function picture(s, cls) {
  const wrap = el("div", { class: "np-pic " + (cls || "") });
  const plate = el("div", { class: "np-plate plate-" + catKey(s.cat) }, "<span>" + catLabel(s.cat) + "</span>");
  wrap.appendChild(plate);
  if (s.img && news) {
    photo(news.date, s.id).then((src) => {
      const im = el("img", { alt: "", src, decoding: "async" });
      wrap.replaceChild(im, plate);
    }).catch(() => {});
  }
  return wrap;
}

// ---------------------------------------------------------------- routes
export function open(parts) {
  if (parts && parts[1]) { openStory(decodeURIComponent(parts[1])); return; }
  load(false);
}

function load(force) {
  const cached = lsGet("crystal.news.last", null);
  if (cached && !force) { news = cached; renderPaper(""); }
  api("/news")
    .then((data) => {
      const changed = !news || news.built !== data.built || news.date !== data.date;
      news = data;
      lsSet("crystal.news.last", data);
      prunePhotos(data.date);
      api("/newsread?date=" + data.date).then((r) => {
        if (r.ids && r.ids.length) {
          const cur = readSetOf(data.date);
          const have = new Set(cur);
          const add = r.ids.filter((i) => !have.has(i));
          if (add.length) {
            lsSet("crystal.read." + data.date, cur.concat(add));
            if (!location.hash.match(/#\/news\/./)) renderPaper("");
          }
        }
      }).catch(() => {});
      if (changed && !location.hash.match(/#\/news\/./)) renderPaper("");
    })
    .catch((e) => {
      if (e === "auth") return;
      if (e === "empty") { news = null; renderPaper("", true); return; }
      if (cached) { news = cached; renderPaper("Offline. Showing the cached paper."); }
      else renderPaper("", true);
    });
}

// ---------------------------------------------------------------- front page
function sectionStories(k) {
  const all = ordered();
  if (k === "front") return all;
  return all.filter((s) => catKey(s.cat) === k);
}
// only sections with something in them today; the front page always
function liveSections() {
  return SECTIONS.filter((x) => x.k === "front" || sectionStories(x.k).length
    || (x.k === "science" && news && news.topic && news.topic.title));
}
const curSect = () => Math.min(Math.max(0, lsGet("crystal.news.sect", 0) || 0), liveSections().length - 1);

function masthead() {
  const date = news ? news.date : todayIso();
  const all = news ? news.stories || [] : [];
  const read = new Set(readSetOf(date));
  const r = all.filter((s) => read.has(s.id)).length;
  const head = el("header", { class: "np-mast" });
  head.appendChild(el("h1", {}, "The Crystal"));
  const line = el("div", { class: "np-line" });
  line.appendChild(el("span", {}, fmtDay(date)));
  line.appendChild(el("span", {}, r ? r + " of " + all.length + " read"
    : all.length + " stories · about " + Math.max(1, Math.round(all.length * 0.7)) + " min"));
  head.appendChild(line);
  const prog = el("div", { class: "np-prog", "aria-hidden": "true" });
  prog.appendChild(el("i", { style: "width:" + (all.length ? (100 * r) / all.length : 0) + "%" }));
  head.appendChild(prog);
  return head;
}

function rail(onPick) {
  const nav = el("nav", { class: "np-rail", "aria-label": "Sections" });
  const row = el("div", { class: "np-railrow" });
  const k = curSect();
  liveSections().forEach((s, i) => {
    const b = el("button", { type: "button", "aria-current": i === k ? "true" : "false" }, s.label);
    b.addEventListener("click", () => onPick(i));
    row.appendChild(b);
  });
  nav.appendChild(row);
  requestAnimationFrame(() => {
    const cur = row.querySelector('[aria-current="true"]');
    if (cur) row.scrollLeft = cur.offsetLeft - 16;
  });
  return nav;
}

function kicker(s, extra) {
  return '<div class="np-kicker">' + catLabel(s.cat)
    + (extra ? ' <span class="n">· ' + extra + "</span>" : "") + "</div>";
}

function openIt(s) {
  return () => { listScroll = window.scrollY; go("#/news/" + encodeURIComponent(s.id)); };
}
function tappable(node, fn) {
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.addEventListener("click", fn);
  node.addEventListener("keydown", (e) => { if (e.key === "Enter") fn(); });
  return node;
}

function firstToday() {
  const b = lsGet("brief.last", null);
  if (!b || b.date !== todayIso() || !Array.isArray(b.timeline)) return "";
  const local = localTicks(b.date);
  const it = b.timeline.find((x) => x && x.kind !== "group" && x.floor !== true && x.label
    && ["action", "outreach", "answer", "listen"].includes(x.kind) && !isDone(x, local, b.built));
  return it ? String(it.label) : "";
}

function endCard() {
  const end = el("section", { class: "np-end" });
  end.appendChild(el("h2", {}, "You're caught up."));
  const day = new Date((news ? news.date : todayIso()) + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "long" });
  end.appendChild(el("p", {}, "That is the whole paper for " + day + ". The next one lands tomorrow morning."));
  const next = firstToday();
  if (next) {
    const b = el("button", { type: "button", class: "np-next" }, "Next up: " + md(next));
    b.addEventListener("click", () => go("#/today"));
    end.appendChild(b);
  }
  return end;
}

function longRead() {
  const t = news && news.topic;
  if (!t || !t.title) return null;
  const sec = el("section", { class: "np-longread" },
    '<div class="np-kicker">The long read · ' + esc(t.field || "science") + "</div>"
    + "<h2>" + esc(t.title) + "</h2><p>" + esc(t.hook || "") + "</p>");
  return tappable(sec, () => { listScroll = window.scrollY; go("#/news/their-topic"); });
}

function renderPaper(offlineNote, noEdition) {
  if (!isTab("news")) return;
  root.innerHTML = "";
  const page = el("div", { class: "np" });
  page.appendChild(masthead());
  if (offlineNote) page.appendChild(el("div", { class: "banner" }, offlineNote));
  if (news && news.mode === "degraded") {
    page.appendChild(el("div", { class: "banner" },
      "Degraded edition: the compile could not read the sources, so nothing here carries a score."));
  }
  page.appendChild(episodeCard("news"));
  root.appendChild(page);

  if (noEdition || !news) {
    page.appendChild(emptyState("🗞", "No paper yet",
      "The paper is printed with the morning build. Nothing has been published today."));
    root.appendChild(appFooter(() => load(true)));
    return;
  }

  const pick = (i) => { lsSet("crystal.news.sect", i); listScroll = 0; renderPaper(""); };
  page.appendChild(rail(pick));
  const main = el("div", { class: "np-main" });
  page.appendChild(main);
  const k = liveSections()[curSect()].k;
  const read = new Set(readSetOf(news.date));

  if (k === "science" && !sectionStories("science").length) {
    const lr = longRead();
    main.appendChild(lr || el("p", { class: "np-note" }, "No long read today."));
  } else {
    const list = sectionStories(k);
    if (!list.length) {
      main.appendChild(el("p", { class: "np-note" }, "Nothing in " + liveSections()[curSect()].label + " today."));
    } else {
      const [lead, ...rest] = list;
      const isS = scored(lead, news);
      const ld = el("section", { class: "np-lead" + (read.has(lead.id) ? " read" : "") });
      const pc = el("div", {});
      pc.appendChild(picture(lead, "wide"));
      if (lead.img && lead.imgCredit) pc.appendChild(el("div", { class: "np-credit" }, "Photo: " + esc(lead.imgCredit)));
      ld.appendChild(pc);
      ld.appendChild(el("div", {}, kicker(lead, Number(lead.sourceCount) + " sources"
        + (isS ? " · reliability " + Number((lead.scoreDetail || {}).reliability || lead.score) : ""))
        + "<h2>" + esc(lead.headline) + "</h2><p>" + esc(lead.deck || lead.oneLiner) + "</p>"));
      main.appendChild(tappable(ld, openIt(lead)));
      const grid = el("div", { class: "np-grid" });
      rest.forEach((s) => {
        const c = el("article", { class: "np-card" + (read.has(s.id) ? " read" : "") });
        c.appendChild(picture(s));
        c.appendChild(el("div", {}, kicker(s) + "<h3>" + esc(s.headline) + "</h3>"));
        grid.appendChild(tappable(c, openIt(s)));
      });
      main.appendChild(grid);
    }
    if (k === "front" || k === "science") { const lr = longRead(); if (lr) main.appendChild(lr); }
  }
  main.appendChild(endCard());
  root.appendChild(appFooter(() => load(true)));
  bindSwipe(main, (dir) => {
    const n = Math.max(0, Math.min(liveSections().length - 1, curSect() + dir));
    if (n !== curSect()) pick(n);
  });
  window.scrollTo(0, listScroll);
}

// horizontal swipe: dir +1 = next section (swipe left), -1 = previous
function bindSwipe(node, fn) {
  let x0 = null, y0 = null;
  node.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  node.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    fn(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------------------------------------------------------------- one story
function withEdition(fn) {
  if (news) { fn(); return; }
  const cached = lsGet("crystal.news.last", null);
  if (cached) { news = cached; fn(); return; }
  api("/news").then((data) => { news = data; lsSet("crystal.news.last", data); fn(); })
    .catch(() => go("#/news"));
}

function openStory(id) {
  withEdition(() => {
    if (id === "their-topic") { renderTopic(); return; }
    const story = (news.stories || []).find((s) => s.id === id);
    if (!story) { go("#/news"); return; }
    markRead(news.date, [id]);
    renderStory(story);
  });
}

const relClass = (r) => (r >= 75 ? "rgreen" : r >= 50 ? "ryellow" : "rred");

function storyShell(posText) {
  root.innerHTML = "";
  window.scrollTo(0, 0);
  const bar = el("div", { class: "np-bar" });
  const back = el("button", { type: "button", class: "np-back" }, "‹ Back to the paper");
  back.addEventListener("click", () => go("#/news"));
  bar.appendChild(back);
  if (posText) bar.appendChild(el("span", { class: "np-kicker" }, posText));
  root.appendChild(bar);
  const onAir = playingShelf("news");
  if (onAir) root.appendChild(onAir);
  const art = el("article", { class: "np-story" });
  root.appendChild(art);
  bindSwipe(art, (dir) => { if (dir < 0) go("#/news"); });
  return art;
}

// sentences joined into short paragraphs, never a list
function paras(arr, per) {
  const out = [];
  const ss = (arr || []).map((t) => String(t).trim()).filter(Boolean)
    .map((t) => (/[.!?"'”’)]$/.test(t) ? t : t + "."));
  for (let i = 0; i < ss.length; i += per) out.push(ss.slice(i, i + per).join(" "));
  return out;
}

function solidFold(s) {
  const isS = scored(s, news);
  const d = s.scoreDetail || {};
  const det = el("details", { class: "np-solid" });
  const rel = isS && d.reliability != null ? Number(d.reliability) : null;
  det.appendChild(el("summary", {}, rel != null
    ? '<span class="reldot ' + relClass(rel) + '"></span>How solid is this · reliability ' + rel
    : "How solid is this · unscored"));
  const body = el("div", {});
  if (s.evidence) body.appendChild(el("p", {}, "<b>Evidence:</b> " + esc(s.evidence)));
  // "What is solid" is the body over again, so it is not shown
  [["Not known yet", s.notKnown], ["Who says it", s.whoSays]].forEach(([h, arr]) => {
    if (Array.isArray(arr) && arr.length) {
      body.appendChild(el("p", {}, "<b>" + h + ":</b> " + esc(paras(arr, 99)[0])));
    }
  });
  if (s.primary && s.primary.url) {
    body.appendChild(el("p", {}, "<b>Primary document:</b> " + md("[" + (s.primary.name || "source") + "](" + s.primary.url + ")")));
  }
  if (isS) {
    body.appendChild(el("p", {}, "Charge (how heated the framing is): " + Number(d.charge || 0)
      + " of 100. Reliability is how well sourced and corroborated it is, never how relevant it is to you."));
    if (d.reasoning) body.appendChild(el("p", { class: "np-dim" }, esc(d.reasoning)));
  } else {
    body.appendChild(el("p", {}, "This edition was built without an evaluation pass. Read the sources on their own terms."));
  }
  if (s.contested && (s.interpretations || []).length) {
    body.appendChild(el("p", {}, "<b>Contested, the facts are agreed and the reading is not:</b> "
      + esc(paras(s.interpretations, 99)[0])));
  }
  det.appendChild(body);
  return det;
}

function askBox(s) {
  const wrap = el("div", { class: "np-ask" });
  const btn = el("button", { type: "button", class: "np-askbtn" }, "🪞 Ask about this story");
  const panel = el("div", { class: "np-askpanel", hidden: "" });
  const lab = el("label", { class: "np-kicker", for: "np-askq" }, "Your question, answered in tomorrow's Daily Update");
  const ta = el("textarea", { id: "np-askq", rows: "3", placeholder: "Type your question" });
  const row = el("div", { class: "np-askrow" });
  row.appendChild(el("span", { class: "np-askon" }, "On: " + esc(s.headline)));
  const send = el("button", { type: "button", class: "np-send" }, "Send");
  row.appendChild(send);
  const stat = el("p", { class: "np-askstat", "aria-live": "polite" });
  panel.append(lab, ta, row, stat);
  btn.addEventListener("click", () => {
    if (panel.hasAttribute("hidden")) { panel.removeAttribute("hidden"); ta.focus(); }
    else panel.setAttribute("hidden", "");
  });
  send.addEventListener("click", () => {
    const q = ta.value.trim();
    if (!q) { stat.textContent = "Type a question first."; return; }
    // rides the Desk queue (offline-safe); news_answers files it and the
    // Daily Update (lighthouse, update.js) shows the answer next morning
    const ok = queueDesk("ask [news:" + s.id + "]: " + q, "news/" + s.id);
    if (!ok) { stat.textContent = "Could not save it on this phone (storage full). Try the 🪞 button."; return; }
    ta.value = "";
    stat.textContent = "Saved. The answer will be in tomorrow's Daily Update.";
  });
  wrap.append(btn, panel);
  return wrap;
}

function nextButton(label, title, fn) {
  const b = el("button", { type: "button", class: "np-nextstory" },
    '<span class="np-kicker">' + label + "</span><b>" + title + "</b>");
  b.addEventListener("click", fn);
  return b;
}

function renderStory(s) {
  if (!isTab("news")) return;
  const list = ordered();
  const i = list.findIndex((x) => x.id === s.id);
  const art = storyShell((i + 1) + " of " + list.length);
  art.appendChild(picture(s, "wide"));
  if (s.img && s.imgCredit) art.appendChild(el("div", { class: "np-credit" }, "Photo: " + esc(s.imgCredit)));
  art.appendChild(el("div", { class: "np-kicker np-gap" }, catLabel(s.cat)
    + (s.evidence ? ' <span class="n">· ' + esc(s.evidence) + "</span>" : "")));
  art.appendChild(el("h2", {}, esc(s.headline)));

  const sBody = bodyParas(s.body);
  if (sBody.length) {
    if (s.deck) art.appendChild(el("p", { class: "np-deck" }, esc(s.deck)));
    const prose = el("div", { class: "np-prose" });
    sBody.forEach((p) => prose.appendChild(el("p", {}, esc(p))));
    art.appendChild(prose);
    if (s.forYou) art.appendChild(el("p", { class: "np-why" }, '<span class="np-kicker">For you</span><br>' + esc(s.forYou)));
  } else {
    art.appendChild(el("p", { class: "np-deck" }, esc(s.oneLiner)));
    const prose = el("div", { class: "np-prose" });
    paras(s.facts, 3).concat(s.context ? [s.context] : []).forEach((p) => prose.appendChild(el("p", {}, esc(p))));
    art.appendChild(prose);
    if (s.whyItMatters) art.appendChild(el("p", { class: "np-why" }, '<span class="np-kicker">For you</span><br>' + esc(s.whyItMatters)));
  }

  art.appendChild(askBox(s));
  art.appendChild(solidFold(s));

  art.appendChild(el("h4", {}, "Sources"));
  const src = (s.sources || []).map((x) => (x.url && /^https:\/\//.test(x.url)
    ? md("[" + x.name + "](" + x.url + ")") : esc(x.name))).join(" · ");
  art.appendChild(el("p", { class: "np-src" }, src));

  const nx = list[i + 1];
  art.appendChild(nx
    ? nextButton("Next story", esc(nx.headline), () => go("#/news/" + encodeURIComponent(nx.id)))
    : nextButton("That was the last story", "Back to the paper", () => go("#/news")));
  root.appendChild(appFooter(() => { load(true); go("#/news"); }));
}

function renderTopic() {
  if (!isTab("news")) return;
  const t = news.topic;
  if (!t) { go("#/news"); return; }
  const art = storyShell("The long read");
  art.appendChild(el("div", { class: "np-pic wide" }, '<div class="np-plate plate-science"><span>' + esc(t.field || "science") + "</span></div>"));
  art.appendChild(el("h2", {}, esc(t.title)));
  if (t.hook) art.appendChild(el("p", { class: "np-deck" }, esc(t.hook)));
  const tBody = bodyParas(t.body);
  if (tBody.length) {
    const prose = el("div", { class: "np-prose" });
    tBody.forEach((p) => prose.appendChild(el("p", {}, esc(p))));
    art.appendChild(prose);
  } else {
    const prose = el("div", { class: "np-prose" });
    paras(t.facts, 3).concat(t.context ? [t.context] : []).forEach((p) => prose.appendChild(el("p", {}, esc(p))));
    art.appendChild(prose);
  }
  art.appendChild(askBox({ id: "their-topic", headline: t.title }));
  if (t.sources && t.sources.length) {
    art.appendChild(el("h4", {}, "Sources"));
    art.appendChild(el("p", { class: "np-src" }, t.sources.map((x) => (x.url && /^https:\/\//.test(x.url)
      ? md("[" + x.name + "](" + x.url + ")") : esc(x.name))).join(" · ")));
  }
  art.appendChild(nextButton("Done", "Back to the paper", () => go("#/news")));
  root.appendChild(appFooter(() => { load(true); go("#/news"); }));
}

// the money tab borrows the cached edition to show related stories
export const cachedEdition = () => news || lsGet("crystal.news.last", null);
