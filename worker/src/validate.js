// Schema validators for the Crystal Worker's POST payloads. Each returns
// null when the shape is good, or a human-useful error string naming the
// exact field that broke. Shared by the Worker and tools/test_schemas.mjs.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const STORY_ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && isFinite(v);
const isArr = Array.isArray;

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
    if (!isStr(s.cat) || !s.cat) return `${at}.cat required (ai|aero|world|energy|sports)`;
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
// {date, built, sections:[{id, title, md}]}
export function validateMarkets(p) {
  if (!p || typeof p !== "object") return "payload must be a JSON object";
  if (!DATE_RE.test(p.date || "")) return "date must be YYYY-MM-DD";
  if (!isStr(p.built)) return "built (ISO timestamp string) required";
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
