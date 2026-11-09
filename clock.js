// clock.js: the Day clock tab and the "now doing" pill on every tab.
//
// David, 2026-11-09 (staircase): "i want to do a day clock where i have an
// ongoing stopwatch and time how long i spend doing each thing cause only when
// i have data and consistency can i tell how i can change." Target: 12 h of
// work a day, 5 days a week.
//
// The failure mode of every manual timer is FORGETTING TO SWITCH, so the whole
// surface is built against it:
//   - one tap switches (the running block ends, the new one starts, no stop button)
//   - the pill on every tab says what is running and for how long
//   - "started earlier?" right after a switch (you tap gym on the way out, not at the door)
//   - the idle catch: a block past 3 h (sleep 11 h) asks "still on it?" on open
//   - any block can be fixed or painted in after the fact
// The arithmetic lives in clockcore.js (pure, tested in tools/test_clock.mjs).
// Storage: this phone's localStorage is the source of truth (works with no
// signal); each changed day is posted whole to the Worker's /clock through the
// ordinary JSON queue, and the laptop reads it with crystal_clock.py.

import { root, el, lsGet, lsSet, api, mastHead, renderDays, todayIso, isoOf, isTab, go } from "./core.js";
import { queueClock, flush } from "./sync.js";
import * as C from "./clockcore.js";

const LOG = "crystal.clock.log";
const OK = "crystal.clock.ok";
const IG = "crystal.clock.ig";
const CFG = "crystal.clock.cfg";
const KEEP_DAYS = 120;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const getLog = () => lsGet(LOG, []);
function cfg() {
  const c = lsGet(CFG, null) || {};
  return { cats: Array.isArray(c.cats) && c.cats.length ? c.cats : C.DEFAULT_CATS,
    courses: Array.isArray(c.courses) ? c.courses.filter((x) => typeof x === "string").slice(0, 12) : [] };
}
const label = (cat, sub) => C.catOf(cfg().cats, cat).label + (sub ? " · " + sub : "");

// Keep about four months on the phone (the Worker holds 400 days), always
// keeping the switch that was running when the window opens.
function prune(log) {
  const cut = Date.now() - KEEP_DAYS * 86400e3;
  const n = C.normalize(log);
  const i = n.findIndex((e) => e.at >= cut);
  return i > 0 ? n.slice(i - 1) : n;
}

// Save, then post every day from `fromMs` to today (an edit on Tuesday moves
// what Wednesday started with). Capped at 9 days back.
function save(log, fromMs) {
  const n = prune(log);
  lsSet(LOG, n);
  const igs = lsGet(IG, {});
  const today = todayIso();
  let d = isoOf(new Date(Math.max(fromMs, Date.now() - 9 * 86400e3)));
  for (let k = 0; k < 10 && d <= today; k++, d = C.addDays(d, 1)) queueClock(C.snapshot(n, d, { ig: igs[d] }));
  paintPill();
  return n;
}

// ---------- the pill, on every tab ----------
let pill = null;
let pillTick = null;
export function mountPill() {
  if (pill) return;
  pill = el("button", { type: "button", class: "clockpill", "aria-label": "Day clock" });
  pill.addEventListener("click", () => go("#/clock"));
  document.body.appendChild(pill);
  paintPill();
  pillTick = setInterval(paintPill, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { paintPill(); if (isTab("clock")) render(); }
  });
  // The first open of a day re-posts the last 7 days whole. It shows the laptop
  // a sleep block that crossed midnight before the first tap of the morning,
  // and it heals any post the queue dropped (sync.js drops a 4xx head, e.g. a
  // 404 if the app ever ships ahead of the Worker). Posts replace, so it is
  // idempotent; seven small snapshots once a day.
  const sent = lsGet("crystal.clock.sent", "");
  if (getLog().length && sent !== todayIso()) {
    const igs = lsGet(IG, {});
    for (let k = 6; k >= 0; k--) {
      const d = C.addDays(todayIso(), -k);
      queueClock(C.snapshot(getLog(), d, { ig: igs[d] }));
    }
    lsSet("crystal.clock.sent", todayIso());
  }
}
export function paintPill() {
  if (!pill) return;
  const tabbarHidden = document.getElementById("tabbar").hidden;
  const c = C.current(getLog());
  pill.hidden = tabbarHidden || isTab("clock");
  const ask = C.needsCheck(getLog(), Date.now(), lsGet(OK, 0));
  pill.classList.toggle("ask", !!ask);
  if (!c) { pill.textContent = "⏱ start the day clock"; return; }
  pill.textContent = (ask ? "Still " + label(c.cat, c.sub) + "? " : "⏱ " + label(c.cat, c.sub) + " · ")
    + C.fmtDur(Date.now() - c.at);
}

// ---------- the tab ----------
let viewDay = "";      // "" = today
let retro = null;      // {id, until}: the "started earlier?" bar after a switch
let pendingAt = null;  // "I switched at ___": the next category tap lands here
let openSub = false;   // the homework course chips are showing
let editing = null;    // id of the block being edited
let adding = false;    // the "add a block I forgot" form
let ticker = null;

export function open(parts) {
  viewDay = parts && parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1]) ? parts[1] : "";
  render();
  api("/clockconfig").then((c) => { lsSet(CFG, c); if (isTab("clock")) render(); }).catch(() => {});
  flush();
}

function switchTo(cat, sub) {
  const log = getLog();
  const now = Date.now();
  const cur = C.current(log);
  let at = now;
  if (pendingAt) at = Math.min(now, Math.max(pendingAt, cur ? cur.at + 60000 : -Infinity));
  if (cur && cur.cat === cat && (cur.sub || "") === (sub || "") && !pendingAt) { openSub = false; render(); return; }
  const e = { id: uid(), at, cat, sub: sub || "" };
  save(log.concat([e]), at);
  lsSet(OK, 0);
  retro = pendingAt ? null : { id: e.id, until: now + 120000 };
  pendingAt = null;
  openSub = false;
  render();
}

function backBy(min) {
  if (!retro) return;
  const log = getLog();
  const e = C.normalize(log).find((x) => x.id === retro.id);
  if (!e) { retro = null; render(); return; }
  save(C.backdate(log, e.id, e.at - min * 60000), e.at - min * 60000);
  render();
}

// "HH:MM" on the shown day -> epoch ms
function atOn(iso, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
}
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

function timeInput(value) {
  const i = document.createElement("input");
  i.type = "time";
  i.value = value;
  i.className = "clocktime";
  return i;
}
function catSelect(value, sub) {
  const s = document.createElement("select");
  s.className = "clocksel";
  const { cats, courses } = cfg();
  for (const c of cats) {
    if (c.subs && courses.length) {
      for (const co of courses) s.appendChild(new Option(c.label + " · " + co, c.id + "|" + co));
      s.appendChild(new Option(c.label + " · other", c.id + "|"));
    } else s.appendChild(new Option(c.label, c.id + "|"));
  }
  s.value = value + "|" + (sub || "");
  if (s.selectedIndex < 0) s.value = value + "|";
  return s;
}
const splitSel = (v) => { const i = v.indexOf("|"); return [v.slice(0, i), v.slice(i + 1)]; };

function render() {
  if (!isTab("clock")) { if (ticker) { clearInterval(ticker); ticker = null; } return; }
  const y = window.scrollY;
  root.innerHTML = "";
  const now = Date.now();
  const log = getLog();
  const cur = C.current(log);
  const { cats, courses } = cfg();
  const today = todayIso();
  const day = viewDay || today;

  root.appendChild(mastHead("clock", "Day clock",
    "One tap when you switch. The data is for the Sunday review, not a grade."));

  // ---- now ----
  const nowCard = el("section", { class: "clocknow" });
  if (cur) {
    nowCard.appendChild(el("div", { class: "cnlabel" }, ""));
    nowCard.lastChild.textContent = label(cur.cat, cur.sub);
    const since = el("div", { class: "cnsince" }, "");
    const paintSince = () => { since.textContent = "since " + C.fmtClock(cur.at) + " · " + C.fmtDur(Date.now() - cur.at); };
    paintSince();
    nowCard.appendChild(since);
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => { if (!isTab("clock")) { clearInterval(ticker); ticker = null; return; } paintSince(); }, 15000);
  } else {
    nowCard.appendChild(el("div", { class: "cnlabel" }, "Nothing running yet"));
    nowCard.appendChild(el("div", { class: "cnsince" }, "Tap what you are doing right now. From then on, tap only when you switch."));
  }
  const ask = C.needsCheck(log, now, lsGet(OK, 0));
  if (ask && !pendingAt) {
    const b = el("div", { class: "clockask" });
    b.appendChild(el("p", {}, ""));
    b.firstChild.textContent = "Still " + label(ask.cat, ask.sub) + "? It has run " + C.fmtDur(now - ask.at) + ".";
    const yes = el("button", { type: "button" }, "Yes, still on it");
    yes.addEventListener("click", () => { lsSet(OK, Date.now()); paintPill(); render(); });
    const no = el("button", { type: "button" }, "No, I switched at...");
    no.addEventListener("click", () => { pendingAt = Math.min(now, ask.at + 3600e3); render(); });
    b.appendChild(yes); b.appendChild(no);
    nowCard.appendChild(b);
  }
  if (pendingAt) {
    const b = el("div", { class: "clockask" });
    b.appendChild(el("p", {}, "I switched at"));
    const ti = timeInput(hhmm(pendingAt));
    ti.addEventListener("change", () => { if (ti.value) pendingAt = Math.min(Date.now(), atOn(today, ti.value)); });
    b.firstChild.appendChild(ti);
    b.appendChild(el("p", { class: "cnhint" }, "then tap what you switched to."));
    const cancel = el("button", { type: "button" }, "Cancel");
    cancel.addEventListener("click", () => { pendingAt = null; render(); });
    b.appendChild(cancel);
    nowCard.appendChild(b);
  }
  if (retro && retro.until > now) {
    const r = el("div", { class: "clockretro" });
    r.appendChild(el("span", {}, "Started earlier?"));
    for (const m of [5, 10, 15, 30]) {
      const b = el("button", { type: "button" }, "−" + m + "m");
      b.addEventListener("click", () => backBy(m));
      r.appendChild(b);
    }
    const ti = timeInput(hhmm((C.normalize(log).find((x) => x.id === retro.id) || { at: now }).at));
    ti.setAttribute("aria-label", "exact start time");
    ti.addEventListener("change", () => {
      if (!ti.value) return;
      const t = atOn(today, ti.value);
      save(C.backdate(getLog(), retro.id, t), t);
      render();
    });
    r.appendChild(ti);
    nowCard.appendChild(r);
  }
  root.appendChild(nowCard);

  // ---- the switch grid ----
  const grid = el("div", { class: "clockgrid" });
  for (const c of cats) {
    const on = cur && cur.cat === c.id;
    const b = el("button", { type: "button", class: "cg" + (on ? " on" : "") + (c.work ? " work" : "") }, "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      if (c.subs && courses.length) { openSub = !openSub; render(); return; }
      switchTo(c.id, "");
    });
    grid.appendChild(b);
    if (c.subs && courses.length && openSub) {
      const row = el("div", { class: "cgsubs" });
      for (const co of courses.concat(["other"])) {
        const sb = el("button", { type: "button", class: on && (cur.sub || "other") === co ? "on" : "" }, "");
        sb.textContent = co;
        sb.addEventListener("click", () => switchTo(c.id, co === "other" ? "" : co));
        row.appendChild(sb);
      }
      grid.appendChild(row);
    }
  }
  root.appendChild(grid);

  // ---- totals: today and this week ----
  const [d0, d1] = C.dayBounds(day);
  const t = C.totals(log, d0, d1, now, cats);
  const ws = C.weekStart(day);
  const [w0] = C.dayBounds(ws);
  const [, w1] = C.dayBounds(C.addDays(ws, 6));
  const wt = C.totals(log, w0, w1, now, cats);
  const sum = el("section", { class: "clocksum" });
  const isToday = day === today;
  sum.appendChild(el("div", { class: "csrow big" },
    "<span>Work " + (isToday ? "today" : "that day") + "</span><b>" + C.fmtHours(t.work) + "</b><i>of " + C.DAY_TARGET_H + " h</i>"));
  sum.appendChild(el("div", { class: "csrow big" },
    "<span>Work " + (ws === C.weekStart(today) ? "this week" : "that week") + "</span><b>" + C.fmtHours(wt.work) + "</b><i>of " + C.WEEK_TARGET_H + " h</i>"));
  const order = Object.keys(t.by).sort((a, b) => t.by[b] - t.by[a]);
  const list = el("div", { class: "cslist" });
  for (const id of order) {
    const r = el("div", { class: "csrow" }, "<span></span><b>" + C.fmtDur(t.by[id]) + "</b>");
    r.firstChild.textContent = C.catOf(cats, id).label;
    list.appendChild(r);
    for (const k of Object.keys(t.subs).filter((s) => s.startsWith(id + ":"))) {
      const sr = el("div", { class: "csrow sub" }, "<span></span><b>" + C.fmtDur(t.subs[k]) + "</b>");
      sr.firstChild.textContent = k.slice(id.length + 1);
      list.appendChild(sr);
    }
  }
  if (!order.length) list.appendChild(el("p", { class: "cnhint" }, "Nothing tracked on this day."));
  sum.appendChild(list);

  // Instagram, honestly: the taps only catch the scrolling he noticed. The
  // Screen Time number catches all of it, so both sit side by side.
  const igs = lsGet(IG, {});
  const ig = el("div", { class: "clockig" });
  ig.appendChild(el("div", {}, "<b>Instagram</b> · tapped " + C.fmtDur(t.by.phone || 0)
    + (Number.isFinite(igs[day]) ? " · Screen Time " + C.fmtDur(igs[day] * 60000) : "")));
  const igIn = document.createElement("input");
  igIn.type = "number"; igIn.inputMode = "numeric"; igIn.min = "0"; igIn.max = "1440";
  igIn.placeholder = "min"; igIn.className = "clocknum";
  if (Number.isFinite(igs[day])) igIn.value = igs[day];
  const igSave = el("button", { type: "button" }, "Save");
  igSave.addEventListener("click", () => {
    const v = Math.round(Number(igIn.value));
    const all = lsGet(IG, {});
    if (igIn.value === "" ) delete all[day];
    else if (Number.isFinite(v) && v >= 0 && v <= 1440) all[day] = v;
    else return;
    lsSet(IG, all);
    queueClock(C.snapshot(getLog(), day, { ig: all[day] }));
    render();
  });
  const igRow = el("div", { class: "igrow" });
  igRow.appendChild(el("span", {}, "Screen Time minutes for this day:"));
  igRow.appendChild(igIn); igRow.appendChild(igSave);
  ig.appendChild(igRow);
  ig.appendChild(el("p", { class: "cnhint" }, "Settings, Screen Time, See All App &amp; Website Activity, Instagram. Ten seconds at night."));
  sum.appendChild(ig);
  root.appendChild(sum);

  // ---- the day, block by block ----
  root.appendChild(el("h2", { class: "clockh" }, "The day"));
  root.appendChild(renderDays(viewDay ? day : "", (back, iso) => {
    viewDay = back ? iso : ""; editing = null; adding = false;
    history.replaceState(null, "", viewDay ? "#/clock/" + viewDay : "#/clock");
    render();
  }));
  const bl = C.blocks(log, d0, d1, now).reverse();
  const tl = el("div", { class: "clocktl" });
  for (const b of bl) {
    const row = el("button", { type: "button", class: "ctrow" + (C.catOf(cats, b.cat).work ? " work" : "") + (editing === b.id ? " sel" : "") });
    row.appendChild(el("span", { class: "ctt" }, C.fmtClock(b.start) + " to " + (b.open ? "now" : C.fmtClock(b.end))));
    const nm = el("span", { class: "ctn" }, "");
    nm.textContent = label(b.cat, b.sub);
    row.appendChild(nm);
    row.appendChild(el("span", { class: "ctd" }, C.fmtDur(b.ms)));
    row.addEventListener("click", () => { editing = editing === b.id ? null : b.id; adding = false; render(); });
    tl.appendChild(row);
    if (editing === b.id) tl.appendChild(editor(b, day));
  }
  if (!bl.length) tl.appendChild(el("p", { class: "cnhint" }, "No blocks on this day."));
  root.appendChild(tl);

  const addBtn = el("button", { type: "button", class: "clockadd" }, adding ? "Close" : "+ Add a block I forgot");
  addBtn.addEventListener("click", () => { adding = !adding; editing = null; render(); });
  root.appendChild(addBtn);
  if (adding) root.appendChild(adder(day));

  // ---- the week ----
  root.appendChild(el("h2", { class: "clockh" }, "This week"));
  const wk = el("div", { class: "clockweek" });
  wk.appendChild(el("div", { class: "cwrow head" }, "<span></span><b>work</b><b>sleep</b><b>insta</b>"));
  for (let k = 0; k < 7; k++) {
    const iso = C.addDays(ws, k);
    const [a, z] = C.dayBounds(iso);
    if (a > now) break;
    const dt = C.totals(log, a, z, now, cats);
    const igd = igs[iso];
    wk.appendChild(el("div", { class: "cwrow" + (iso === day ? " sel" : "") },
      "<span>" + new Date(a).toLocaleDateString("en-US", { weekday: "short" }) + "</span><b>" + C.fmtHours(dt.work)
      + "</b><b>" + C.fmtHours(dt.by.sleep || 0) + "</b><b>" + (Number.isFinite(igd) ? C.fmtDur(igd * 60000) : C.fmtDur(dt.by.phone || 0) + "*") + "</b>"));
  }
  wk.appendChild(el("p", { class: "cnhint" }, "insta: Screen Time minutes where entered; * means only the tapped time. "
    + "Work counts class, homework, PURPL, Zeng, job search and TTP / ASME."));
  root.appendChild(wk);
  root.appendChild(el("p", { class: "cnhint", id: "sync" }, ""));
  flush();
  window.scrollTo(0, y);
}

function editor(b, day) {
  const box = el("div", { class: "clockedit" });
  const sel = catSelect(b.cat, b.sub);
  const ti = timeInput(hhmm(b.realStart));
  const startsEarlier = b.realStart < C.dayBounds(day)[0];
  const r1 = el("label", {}, "<span>What it was</span>"); r1.appendChild(sel);
  const r2 = el("label", {}, "<span>Started at</span>"); r2.appendChild(ti);
  box.appendChild(r1);
  if (!startsEarlier) box.appendChild(r2);
  else box.appendChild(el("p", { class: "cnhint" }, "This block started the day before; edit its start there."));
  const save1 = el("button", { type: "button", class: "primary" }, "Save");
  save1.addEventListener("click", () => {
    let log = getLog();
    const [cat, sub] = splitSel(sel.value);
    log = C.recat(log, b.id, cat, sub);
    let from = b.realStart;
    if (!startsEarlier && ti.value && ti.value !== hhmm(b.realStart)) {
      const t = Math.min(Date.now(), atOn(day, ti.value));
      log = C.backdate(log, b.id, t);
      from = Math.min(from, t);
    }
    save(log, from);
    editing = null;
    render();
  });
  const del = el("button", { type: "button" }, "Delete (folds into the block before)");
  del.addEventListener("click", () => { save(C.remove(getLog(), b.id), b.realStart); editing = null; render(); });
  const row = el("div", { class: "cerow" });
  row.appendChild(save1); row.appendChild(del);
  box.appendChild(row);
  return box;
}

function adder(day) {
  const box = el("div", { class: "clockedit" });
  const sel = catSelect("gym", "");
  const now = Date.now();
  const base = day === todayIso() ? now : C.dayBounds(day)[0] + 12 * 3600e3;
  const a = timeInput(hhmm(base - 3600e3));
  const z = timeInput(hhmm(base));
  const r0 = el("label", {}, "<span>What it was</span>"); r0.appendChild(sel);
  const r1 = el("label", {}, "<span>From</span>"); r1.appendChild(a);
  const r2 = el("label", {}, "<span>To</span>"); r2.appendChild(z);
  box.appendChild(r0); box.appendChild(r1); box.appendChild(r2);
  const msg = el("p", { class: "cnhint" }, "Whatever was running at the end time picks back up after it.");
  box.appendChild(msg);
  const go1 = el("button", { type: "button", class: "primary" }, "Add it");
  go1.addEventListener("click", () => {
    if (!a.value || !z.value) { msg.textContent = "Set both times."; return; }
    const s = atOn(day, a.value);
    let e = atOn(day, z.value);
    if (e <= s) e += 86400e3; // 11:30 pm to 1:00 am runs past midnight
    if (s >= Date.now()) { msg.textContent = "That starts in the future."; return; }
    const [cat, sub] = splitSel(sel.value);
    save(C.paint(getLog(), s, e, cat, sub, uid, Date.now()), s);
    adding = false;
    render();
  });
  box.appendChild(go1);
  return box;
}
