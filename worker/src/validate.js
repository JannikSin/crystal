// Schema validators for the Crystal Worker's POST payloads. Each returns
// null when the shape is good, or a human-useful error string naming the
// exact field that broke. Shared by the Worker and tools/test_schemas.mjs.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
// hash ids (10 hex) or stable slugs (sleep-lights-out). One bound, shared by
// the Worker, pull_ticks and the client slugifier: 1 to 40 chars, lowercase.
// The floor is 1 because a question id is legitimately "q1".
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// the only base64 that still rides inside a payload: the brief's scan thumbnail
export const IMG_DATAURL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const STORY_ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
// The closed set of categories. The long labels are what news_compile.py
// writes; the short keys are what news.js normalises them to. Anything else
// falls through the app's CAT_LABEL table and renders as raw payload text.
const NEWS_CATS = ["AI/Tech", "Aerospace/Defense", "World/Politics", "Energy/Nuclear",
  "Sports-discovery", "ai", "aero", "world", "energy", "sports"];

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && isFinite(v);
const isArr = Array.isArray;
const isTxt = (v) => isStr(v) && !!v.trim();
const isHttps = (v) => isStr(v) && v.startsWith("https://");

// ---------- news ----------
// {date, built, stories:[{id, cat, rank, headline, oneLiner, facts[], context,
//   whyItMatters, score, scoreDetail:{reliability, charge, reasoning},
//   sources:[{name, note}], sourceCount, crossSector, contested,
//   interpretations[], tickerTags[]}], notShownCount}
export function validateNews(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (!isArr(p.stories)) return "stories must be an array";
  if (p.stories.length > 60) return "stories: more than 60, that is not a brief";
  if (p.notShownCount !== undefined && !isNum(p.notShownCount))
    return "notShownCount must be a number";
  const seen = new Set();
  for (let i = 0; i < p.stories.length; i++) {
    const s = p.stories[i];
    const at = `stories[${i}]`;
    if (!s || typeof s !== "object") return `${at} must be an object`;
    if (!STORY_ID_RE.test(s.id || "")) return `${at}.id must match ${STORY_ID_RE}`;
    if (seen.has(s.id)) return `${at}.id "${s.id}" is a duplicate`;
    seen.add(s.id);
    if (!NEWS_CATS.includes(s.cat)) return `${at}.cat must be one of ${NEWS_CATS.join("|")}`;
    if (!isNum(s.rank)) return `${at}.rank must be a number`;
    if (!isStr(s.headline) || !s.headline.trim()) return `${at}.headline required`;
    if (!isStr(s.oneLiner) || !s.oneLiner.trim()) return `${at}.oneLiner required`;
    if (!isArr(s.facts) || !s.facts.every(isStr)) return `${at}.facts must be an array of strings`;
    if (!isStr(s.context)) return `${at}.context must be a string`;
    if (!isStr(s.whyItMatters)) return `${at}.whyItMatters must be a string`;
    if (!isNum(s.score) || s.score < 1 || s.score > 100) return `${at}.score must be 1-100`;
    const d = s.scoreDetail;
    if (!d || typeof d !== "object") return `${at}.scoreDetail required`;
    if (!isNum(d.reliability) || d.reliability < 1 || d.reliability > 100)
      return `${at}.scoreDetail.reliability must be 1-100`;
    if (!isNum(d.charge) || d.charge < 1 || d.charge > 100)
      return `${at}.scoreDetail.charge must be 1-100`;
    if (!isStr(d.reasoning) || !d.reasoning.trim())
      return `${at}.scoreDetail.reasoning required (the written why)`;
    if (!isArr(s.sources) || !s.sources.length) return `${at}.sources must be a non-empty array`;
    for (let j = 0; j < s.sources.length; j++) {
      const src = s.sources[j];
      if (!src || !isStr(src.name) || !src.name.trim())
        return `${at}.sources[${j}].name required`;
      if (src.note !== undefined && !isStr(src.note))
        return `${at}.sources[${j}].note must be a string`;
    }
    if (!isNum(s.sourceCount) || s.sourceCount < 1) return `${at}.sourceCount must be >= 1`;
    if (typeof s.crossSector !== "boolean") return `${at}.crossSector must be a boolean`;
    if (typeof s.contested !== "boolean") return `${at}.contested must be a boolean`;
    if (!isArr(s.interpretations) || !s.interpretations.every(isStr))
      return `${at}.interpretations must be an array of strings`;
    if (s.contested && !s.interpretations.length)
      return `${at} is contested but has no interpretations`;
    if (!isArr(s.tickerTags) || !s.tickerTags.every((t) => isStr(t)))
      return `${at}.tickerTags must be an array of strings`;
  }
  return null;
}

// ---------- markets ----------
// {date, built, sections:[{id, title, md}], tickers?:[{ticker, status, close,
//  movePct, md}]}
export function validateMarkets(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (p.tickers !== undefined) {
    if (!isArr(p.tickers)) return "tickers must be an array";
    for (let i = 0; i < p.tickers.length; i++) {
      const t = p.tickers[i];
      if (!t || typeof t !== "object") return `tickers[${i}] must be an object`;
      if (!TICKER_RE.test(t.ticker || "")) return `tickers[${i}].ticker must match ${TICKER_RE}`;
    }
  }
  if (!isArr(p.sections) || !p.sections.length) return "sections must be a non-empty array";
  for (let i = 0; i < p.sections.length; i++) {
    const s = p.sections[i];
    if (!s || typeof s !== "object") return `sections[${i}] must be an object`;
    if (!isStr(s.id) || !s.id) return `sections[${i}].id required`;
    if (!isStr(s.title) || !s.title.trim()) return `sections[${i}].title required`;
    if (!isStr(s.md)) return `sections[${i}].md must be a markdown string`;
  }
  return null;
}

// ---------- holdings ----------
// {asOf, cash:[{name, amount, earmark}], positions:[{ticker,
//   lots:[{shares, basis, fillDate, ltcgDate, verified}],
//   breakers:[{text, status}], rules:[], nextEvent:{date, label, gate}}]}
export function validateHoldings(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!isStr(p.asOf) || !p.asOf) return "asOf (ISO timestamp string) required";
  if (!isArr(p.cash)) return "cash must be an array (may be empty)";
  for (let i = 0; i < p.cash.length; i++) {
    const c = p.cash[i];
    if (!c || !isStr(c.name) || !c.name.trim()) return `cash[${i}].name required`;
    if (!isNum(c.amount) || c.amount < 0) return `cash[${i}].amount must be a number >= 0`;
    if (c.earmark !== undefined && !isStr(c.earmark)) return `cash[${i}].earmark must be a string`;
  }
  if (!isArr(p.positions)) return "positions must be an array";
  for (let i = 0; i < p.positions.length; i++) {
    const pos = p.positions[i];
    const at = `positions[${i}]`;
    if (!pos || typeof pos !== "object") return `${at} must be an object`;
    if (!TICKER_RE.test(pos.ticker || "")) return `${at}.ticker must match ${TICKER_RE}`;
    if (!isArr(pos.lots) || !pos.lots.length) return `${at}.lots must be a non-empty array`;
    for (let j = 0; j < pos.lots.length; j++) {
      const l = pos.lots[j];
      const lat = `${at}.lots[${j}]`;
      if (!l || typeof l !== "object") return `${lat} must be an object`;
      if (!isNum(l.shares) || l.shares <= 0) return `${lat}.shares must be a number > 0`;
      if (!isNum(l.basis) || l.basis <= 0) return `${lat}.basis (total dollars paid) must be > 0`;
      if (!DATE_RE.test(l.fillDate || "")) return `${lat}.fillDate must be YYYY-MM-DD`;
      if (!DATE_RE.test(l.ltcgDate || "")) return `${lat}.ltcgDate must be YYYY-MM-DD`;
      if (typeof l.verified !== "boolean") return `${lat}.verified must be a boolean`;
    }
    if (!isArr(pos.breakers)) return `${at}.breakers must be an array (may be empty)`;
    for (let j = 0; j < pos.breakers.length; j++) {
      const b = pos.breakers[j];
      if (!b || !isStr(b.text) || !b.text.trim()) return `${at}.breakers[${j}].text required`;
      if (!isStr(b.status) || !b.status.trim()) return `${at}.breakers[${j}].status required`;
    }
    if (!isArr(pos.rules) || !pos.rules.every(isStr))
      return `${at}.rules must be an array of strings`;
    if (pos.nextEvent !== undefined && pos.nextEvent !== null) {
      const e = pos.nextEvent;
      if (!DATE_RE.test(e.date || "")) return `${at}.nextEvent.date must be YYYY-MM-DD`;
      if (!isStr(e.label) || !e.label.trim()) return `${at}.nextEvent.label required`;
      if (e.gate !== undefined && !isStr(e.gate)) return `${at}.nextEvent.gate must be a string`;
    }
  }
  return null;
}

// ---------- brief v2 (the timeline payload) ----------
// {v:2, date, day, strap?, built, scoreboard?[], reward?, feedbackNote?,
//  scanThumb? (data:image/jpeg;base64 under 40KB),
//  timeline:[{id, t, label, tier, kind?, target?, section?, floor?, state?}]}
// v1 payloads are legacy and stay unvalidated; the Worker only calls this
// when body.v === 2.
const SLOTS = ["dawn", "morning", "day", "evening", "night"];
const TIERS = ["floor", "spine", "work", "flex"];
const THUMB_MAX = 40 * 1024;

function validateReward(r) {
  if (!r || typeof r !== "object") return "reward must be an object";
  if (!isArr(r.heldWindow)) return "reward.heldWindow must be an array";
  if (r.heldWindow.length > 35) return "reward.heldWindow: more than 35 days";
  for (let i = 0; i < r.heldWindow.length; i++) {
    const w = r.heldWindow[i];
    const at = `reward.heldWindow[${i}]`;
    if (!w || typeof w !== "object") return `${at} must be an object`;
    if (!DATE_RE.test(w.d || "")) return `${at}.d must be YYYY-MM-DD`;
    if (typeof w.held !== "boolean" && w.held !== null)
      return `${at}.held must be true, false or null (dark day)`;
  }
  if (r.weeklyLive !== undefined && typeof r.weeklyLive !== "boolean")
    return "reward.weeklyLive must be a boolean";
  if (r.weeklyCountdown !== undefined && !isNum(r.weeklyCountdown))
    return "reward.weeklyCountdown must be a number";
  if (r.monthlyCountdown !== undefined && !isNum(r.monthlyCountdown))
    return "reward.monthlyCountdown must be a number";
  if (r.outstanding !== undefined && r.outstanding !== null) {
    const o = r.outstanding;
    if (typeof o !== "object") return "reward.outstanding must be an object";
    if (!ID_RE.test(o.id || "")) return `reward.outstanding.id must match ${ID_RE}`;
    if (!isTxt(o.kind)) return "reward.outstanding.kind required (weekly|monthly)";
    if (!isTxt(o.pick)) return "reward.outstanding.pick required (name the thing)";
    if (!DATE_RE.test(o.issued || "")) return "reward.outstanding.issued must be YYYY-MM-DD";
    if (!DATE_RE.test(o.expires || "")) return "reward.outstanding.expires must be YYYY-MM-DD";
  }
  if (r.procurement !== undefined && !isStr(r.procurement))
    return "reward.procurement must be a string";
  if (r.dailyPick !== undefined && !isStr(r.dailyPick)) return "reward.dailyPick must be a string";
  if (r.dailyAlt !== undefined && (!isArr(r.dailyAlt) || !r.dailyAlt.every(isStr)))
    return "reward.dailyAlt must be an array of strings";
  if (r.fullPick !== undefined && !isStr(r.fullPick)) return "reward.fullPick must be a string";
  return null;
}

export function validateBriefV2(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (p.v !== 2) return "v must be 2";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!isTxt(p.day)) return "day required (Saturday)";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (p.strap !== undefined && !isStr(p.strap)) return "strap must be a string";
  if (p.scoreboard !== undefined && !isArr(p.scoreboard)) return "scoreboard must be an array";
  if (p.feedbackNote !== undefined && !isStr(p.feedbackNote))
    return "feedbackNote must be a string";
  if (p.scanThumb !== undefined) {
    if (!isStr(p.scanThumb) || !IMG_DATAURL_RE.test(p.scanThumb))
      return "scanThumb must be a data:image/jpeg;base64 URL";
    if (p.scanThumb.length > THUMB_MAX) return "scanThumb over 40KB, downscale it";
  }
  if (p.reward !== undefined && p.reward !== null) {
    const bad = validateReward(p.reward);
    if (bad) return bad;
  }
  if (!isArr(p.timeline)) return "timeline must be an array";
  if (p.timeline.length > 40) return "timeline: more than 40 items, that is not a day";
  // kind "group" holds child items (Morning routine > Supplements). Children
  // need no slot or tier (they render inside the group's row); groups nest at
  // most one level deep and every id is unique across the whole tree.
  const seen = new Set();
  let total = 0;
  const validateItem = (it, at, depth) => {
    if (++total > 60) return "timeline: more than 60 items counting group children";
    if (!it || typeof it !== "object") return `${at} must be an object`;
    if (!ID_RE.test(it.id || "")) return `${at}.id must match ${ID_RE}`;
    if (seen.has(it.id)) return `${at}.id "${it.id}" is a duplicate`;
    seen.add(it.id);
    if (depth === 0 && !SLOTS.includes(it.t)) return `${at}.t must be one of ${SLOTS.join("|")}`;
    if (depth > 0 && it.t !== undefined && !SLOTS.includes(it.t))
      return `${at}.t must be one of ${SLOTS.join("|")}`;
    if (!isTxt(it.label)) return `${at}.label required`;
    if (depth === 0 && !TIERS.includes(it.tier)) return `${at}.tier must be one of ${TIERS.join("|")}`;
    if (depth > 0 && it.tier !== undefined && !TIERS.includes(it.tier))
      return `${at}.tier must be one of ${TIERS.join("|")}`;
    for (const f of ["kind", "target", "section", "qid", "detail", "ticklabel"])
      if (it[f] !== undefined && !isStr(it[f])) return `${at}.${f} must be a string`;
    for (const f of ["floor", "state"])
      if (it[f] !== undefined && typeof it[f] !== "boolean")
        return `${at}.${f} must be a boolean`;
    if (it.kind === "group") {
      if (depth >= 2) return `${at}: groups nest at most two levels`;
      if (!isArr(it.children) || !it.children.length) return `${at}.children must be a non-empty array`;
      if (it.children.length > 15) return `${at}.children: more than 15`;
      for (let j = 0; j < it.children.length; j++) {
        const bad = validateItem(it.children[j], `${at}.children[${j}]`, depth + 1);
        if (bad) return bad;
      }
    } else if (it.children !== undefined) {
      return `${at}.children only allowed on kind "group"`;
    }
    return null;
  };
  for (let i = 0; i < p.timeline.length; i++) {
    const bad = validateItem(p.timeline[i], `timeline[${i}]`, 0);
    if (bad) return bad;
  }
  return null;
}

// ---------- listen ----------
// {built, queue:[{id, tags[], show, title, note?, length?, link, kind}],
//  history?:[{id, title, ...}], music?:[{label, link}],
//  audiobook?:{current, where[], activities[]}}
const LISTEN_KINDS = ["podcast", "audiobook", "music"];

export function validateListen(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (!isArr(p.queue)) return "queue must be an array";
  if (p.queue.length > 100) return "queue: more than 100 items, trim it";
  const seen = new Set();
  for (let i = 0; i < p.queue.length; i++) {
    const q = p.queue[i];
    const at = `queue[${i}]`;
    if (!q || typeof q !== "object") return `${at} must be an object`;
    if (!ID_RE.test(q.id || "")) return `${at}.id must match ${ID_RE}`;
    if (seen.has(q.id)) return `${at}.id "${q.id}" is a duplicate`;
    seen.add(q.id);
    if (!isArr(q.tags) || !q.tags.every(isStr)) return `${at}.tags must be an array of strings`;
    if (q.show !== undefined && !isStr(q.show)) return `${at}.show must be a string`;
    if (!isTxt(q.title)) return `${at}.title required`;
    if (q.note !== undefined && !isStr(q.note)) return `${at}.note must be a string`;
    if (q.length !== undefined && !isStr(q.length) && !isNum(q.length))
      return `${at}.length must be a string or a number of minutes`;
    if (q.link !== undefined && !isHttps(q.link)) return `${at}.link must be an https URL`;
    if (!LISTEN_KINDS.includes(q.kind)) return `${at}.kind must be ${LISTEN_KINDS.join("|")}`;
  }
  if (p.history !== undefined) {
    if (!isArr(p.history)) return "history must be an array";
    if (p.history.length > 500) return "history: more than 500 entries, the tape is long enough";
    for (let i = 0; i < p.history.length; i++) {
      const h = p.history[i];
      if (!h || typeof h !== "object") return `history[${i}] must be an object`;
      if (!ID_RE.test(h.id || "")) return `history[${i}].id must match ${ID_RE}`;
      if (!isTxt(h.title)) return `history[${i}].title required`;
    }
  }
  if (p.music !== undefined) {
    if (!isArr(p.music)) return "music must be an array";
    for (let i = 0; i < p.music.length; i++) {
      const m = p.music[i];
      if (!m || typeof m !== "object") return `music[${i}] must be an object`;
      if (!isTxt(m.label)) return `music[${i}].label required`;
      if (!isHttps(m.link)) return `music[${i}].link must be an https URL`;
    }
  }
  if (p.audiobook !== undefined && p.audiobook !== null) {
    const a = p.audiobook;
    if (typeof a !== "object") return "audiobook must be an object";
    if (!isTxt(a.current)) return "audiobook.current required";
    const whereOk = (w) => isStr(w) || (w && typeof w === "object" && isStr(w.label));
    if (!isArr(a.where) || !a.where.every(whereOk))
      return "audiobook.where must be an array of strings or {label, note} rows";
    if (!isArr(a.activities) || !a.activities.every(isStr))
      return "audiobook.activities must be an array of strings";
  }
  return null;
}

// ---------- career ----------
// {built, spotlight?:{rank, name, facet, text}, roster:[same], cap 40,
//  outreach?:{name, body, tickId}, signals?:{date, items[]}, aeroDated?,
//  tracker?:[{to, org, ask, from, due, action, status, kind}]}
function validateCompany(c, at) {
  if (!c || typeof c !== "object") return `${at} must be an object`;
  if (!isNum(c.rank)) return `${at}.rank must be a number`;
  if (!isTxt(c.name)) return `${at}.name required`;
  if (!isTxt(c.facet)) return `${at}.facet required (which angle is on show today)`;
  if (!isStr(c.text)) return `${at}.text must be a string`;
  return null;
}

export function validateCareer(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (p.spotlight !== undefined && p.spotlight !== null) {
    const bad = validateCompany(p.spotlight, "spotlight");
    if (bad) return bad;
  }
  if (!isArr(p.roster)) return "roster must be an array";
  if (p.roster.length > 40) return "roster: more than 40 companies, that is a list not a roster";
  for (let i = 0; i < p.roster.length; i++) {
    const bad = validateCompany(p.roster[i], `roster[${i}]`);
    if (bad) return bad;
  }
  if (p.outreach !== undefined && p.outreach !== null) {
    const o = p.outreach;
    if (typeof o !== "object") return "outreach must be an object";
    if (!isTxt(o.name)) return "outreach.name required (name the person)";
    if (!isStr(o.body)) return "outreach.body must be a string";
    if (!ID_RE.test(o.tickId || "")) return `outreach.tickId must match ${ID_RE}`;
  }
  if (p.signals !== undefined && p.signals !== null) {
    const s = p.signals;
    if (typeof s !== "object") return "signals must be an object";
    if (!DATE_RE.test(s.date || "")) return "signals.date must be YYYY-MM-DD";
    if (!isArr(s.items) || !s.items.every(isStr))
      return "signals.items must be an array of strings";
  }
  if (p.aeroDated !== undefined && !isStr(p.aeroDated)) return "aeroDated must be a string";
  if (p.tracker !== undefined) {
    if (!isArr(p.tracker)) return "tracker must be an array";
    for (let i = 0; i < p.tracker.length; i++) {
      const t = p.tracker[i];
      if (!t || typeof t !== "object") return `tracker[${i}] must be an object`;
      if (!isTxt(t.to)) return `tracker[${i}].to required`;
      if (!isStr(t.org) || !isStr(t.ask) || !isStr(t.status))
        return `tracker[${i}].org/ask/status must be strings`;
    }
  }
  return null;
}

// ---------- feedback ----------
// {date, ran?, items:[{qid, transcriptExcerpt, grade, workshop, bestAnswerRef?,
//  ran?}]}
// grade may be null: the transcriber posts a transcript it could not grade, and
// that is a real state the app renders, not a broken payload. ran is when the
// grader last actually ran, so the app can say so out loud.
export function validateFeedback(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (p.ran !== undefined && !isStr(p.ran)) return "ran must be an ISO timestamp string";
  if (!isArr(p.items)) return "items must be an array";
  if (p.items.length > 20) return "items: more than 20 graded answers for one day";
  for (let i = 0; i < p.items.length; i++) {
    const it = p.items[i];
    const at = `items[${i}]`;
    if (!it || typeof it !== "object") return `${at} must be an object`;
    if (!ID_RE.test(it.qid || "")) return `${at}.qid must match ${ID_RE}`;
    if (!isStr(it.transcriptExcerpt)) return `${at}.transcriptExcerpt must be a string`;
    if (it.grade !== null && !isStr(it.grade) && !isNum(it.grade))
      return `${at}.grade must be a string, a number, or null for ungraded`;
    if (!isStr(it.workshop)) return `${at}.workshop must be a string`;
    if (it.bestAnswerRef !== undefined && !isStr(it.bestAnswerRef))
      return `${at}.bestAnswerRef must be a string`;
    if (it.ran !== undefined && !isStr(it.ran)) return `${at}.ran must be an ISO timestamp string`;
  }
  return null;
}

// ---------- library ----------
// {date, notes:[{id, title, folder, summary, updated, body, uri}]}
// body is the note's markdown, already stripped of frontmatter by the pusher.
export function validateLibrary(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!isArr(p.notes) || !p.notes.length) return "notes must be a non-empty array";
  if (p.notes.length > 200) return "notes: 200 max, trim the index";
  const seen = new Set();
  for (let i = 0; i < p.notes.length; i++) {
    const n = p.notes[i], at = `notes[${i}]`;
    if (!n || typeof n !== "object") return `${at} must be an object`;
    if (!ID_RE.test(n.id || "")) return `${at}.id must match ${ID_RE}`;
    if (seen.has(n.id)) return `${at}.id duplicated: ${n.id}`;
    seen.add(n.id);
    if (!isStr(n.title) || !n.title.trim()) return `${at}.title required`;
    if (!isStr(n.folder)) return `${at}.folder must be a string`;
    if (!isStr(n.body) || !n.body.trim()) return `${at}.body required`;
    if (n.body.length > 120000) return `${at}.body too long (120k max)`;
    if (n.summary !== undefined && !isStr(n.summary)) return `${at}.summary must be a string`;
    if (n.updated !== undefined && !isStr(n.updated)) return `${at}.updated must be a string`;
    // uri lands in an href on the client, so the scheme is closed here too
    if (n.uri !== undefined) {
      if (!isStr(n.uri)) return `${at}.uri must be a string`;
      if (!/^(obsidian:\/\/|https:\/\/)[^\s"'<>`]+$/.test(n.uri)) return `${at}.uri must be an obsidian:// or https:// url with no quotes or spaces`;
    }
  }
  return null;
}

// ---------- moves ----------
// {date, moves:{TICKER:{why, tone, sources:[{label,url}]}}}
// tone is "up" | "down" | "flat" | "none": "none" means no explanation was
// found, which the app must show as "no reason found" rather than inventing one.
const MOVE_TONES = ["up", "down", "flat", "none"];
export function validateMoves(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!p.moves || typeof p.moves !== "object" || isArr(p.moves)) return "moves must be an object keyed by ticker";
  const keys = Object.keys(p.moves);
  if (keys.length > 40) return "moves: 40 tickers max";
  for (const k of keys) {
    if (!TICKER_RE.test(k)) return `moves.${k}: key must match ${TICKER_RE}`;
    const m = p.moves[k], at = `moves.${k}`;
    if (!m || typeof m !== "object") return `${at} must be an object`;
    if (!isStr(m.why) || !m.why.trim()) return `${at}.why required`;
    if (m.why.length > 2000) return `${at}.why too long (2000 max)`;
    if (m.tone !== undefined && MOVE_TONES.indexOf(m.tone) < 0) return `${at}.tone must be one of ${MOVE_TONES}`;
    if (m.sources !== undefined) {
      if (!isArr(m.sources)) return `${at}.sources must be an array`;
      for (let j = 0; j < m.sources.length; j++) {
        const s = m.sources[j];
        if (!s || !isStr(s.label) || !s.label.trim()) return `${at}.sources[${j}].label required`;
        if (!isStr(s.url) || !/^https:\/\//.test(s.url)) return `${at}.sources[${j}].url must be https`;
      }
    }
  }
  return null;
}

// ---------- shopping ----------
// {built, sections:[{title, status, note?, items:[{name, price?, priceText?,
//   desc?, url?, spec?}]}], totals?:{label, amount}[]}
// status is a closed set because shopping.js colours and orders on it; an
// unknown status would render as an uncoloured row that looks like a bug.
const SHOP_STATUS = ["buy", "queued", "held", "blocked", "never", "got"];

function validateShopItem(it, at) {
  if (!it || typeof it !== "object") return `${at} must be an object`;
  if (!isTxt(it.name)) return `${at}.name required`;
  // price is optional (a "free, wear a hat" line has none) but when present it
  // must be a real number, because the tab sums it
  if (it.price !== undefined && it.price !== null && !isNum(it.price))
    return `${at}.price must be a number or omitted`;
  if (it.priceText !== undefined && !isStr(it.priceText)) return `${at}.priceText must be a string`;
  if (it.desc !== undefined && !isStr(it.desc)) return `${at}.desc must be a string`;
  if (it.spec !== undefined && !isStr(it.spec)) return `${at}.spec must be a string`;
  // The URL lands in an href. https only, and no quote/angle/backtick that
  // could close the attribute if a renderer ever built this by hand.
  if (it.url !== undefined && it.url !== null) {
    if (!isHttps(it.url)) return `${at}.url must be https`;
    if (/["'<>`\s]/.test(it.url)) return `${at}.url must not contain quotes, angle brackets or spaces`;
  }
  return null;
}

export function validateShopping(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
  if (!isArr(p.sections)) return "sections must be an array";
  if (p.sections.length > 30) return "sections: more than 30, that is not a shopping list";
  for (let i = 0; i < p.sections.length; i++) {
    const s = p.sections[i], at = `sections[${i}]`;
    if (!s || typeof s !== "object") return `${at} must be an object`;
    if (!isTxt(s.title)) return `${at}.title required`;
    if (!SHOP_STATUS.includes(s.status))
      return `${at}.status must be one of ${SHOP_STATUS.join(", ")}`;
    if (s.note !== undefined && !isStr(s.note)) return `${at}.note must be a string`;
    if (!isArr(s.items)) return `${at}.items must be an array`;
    if (s.items.length > 60) return `${at}.items: more than 60 in one section`;
    for (let j = 0; j < s.items.length; j++) {
      const bad = validateShopItem(s.items[j], `${at}.items[${j}]`);
      if (bad) return bad;
    }
  }
  if (p.totals !== undefined && p.totals !== null) {
    if (!isArr(p.totals)) return "totals must be an array";
    for (let i = 0; i < p.totals.length; i++) {
      const t = p.totals[i];
      if (!t || typeof t !== "object") return `totals[${i}] must be an object`;
      if (!isTxt(t.label)) return `totals[${i}].label required`;
      if (!isNum(t.amount)) return `totals[${i}].amount must be a number`;
    }
  }
  return null;
}
