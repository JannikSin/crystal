// update.js: UPDATE, the Daily Update (lighthouse, 2026-11-25).
//
// David, 2026-11-25: "I want the answers thing to be more of a daily update ...
// I set goals and then you can just work on the tasks ... I'll just review them."
// One page that ends: today's point (his own words from last night), yesterday's
// goal vs what he did, what moved, his questions answered, ideas with yes / no,
// what only he can decide. Built each morning by crystal-assistant/daily_update.py.
//
// Everything he writes here goes to the Desk queue (offline-safe), never to a new
// route: "plan: ..." is tomorrow's point, "did: ..." is tonight's look back,
// "idea yes <id>" / "idea no <id>" is a vote. daily_update.py pull() files them.

import { root, el, md, lsGet, lsSet, loadCached, appFooter, emptyState, isTab, todayIso, fmtDay } from "./core.js";
import { queueDesk } from "./sync.js";

const esc = (s) => md(String(s == null ? "" : s));
const CSS = `
.upd .card{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:14px 16px;margin:12px 0;box-shadow:var(--shadow)}
.upd h2{font-family:var(--serif);font-weight:600;font-size:1.06rem;margin:0 0 8px}
.upd .point{font-family:var(--serif);font-size:1.25rem;line-height:1.35;margin:2px 0 4px}
.upd .lab{font-family:var(--mono);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-top:8px}
.upd .lede{font-family:var(--serif);font-size:1.08rem;line-height:1.4;margin:6px 2px 2px}
.upd ul{list-style:none;padding:0;margin:0}
.upd li{padding:8px 0;border-top:1px solid var(--hairline);line-height:1.4}
.upd li:first-child{border-top:none}
.upd .lane{display:inline-block;font-family:var(--mono);font-size:.64rem;color:var(--accent-ink);background:var(--soft);border:1px solid var(--soft-edge);border-radius:6px;padding:1px 6px;margin-right:6px;vertical-align:1px}
.upd .q{font-weight:600}
.upd .a{color:var(--ink);margin-top:3px}
.upd .dim{color:var(--dim);font-size:.85rem}
.upd .vote{display:flex;gap:8px;margin-top:8px}
.upd .vote button{flex:1;border:1px solid var(--edge);background:var(--press);color:var(--ink);border-radius:10px;padding:9px;font:inherit;font-weight:600}
.upd .vote button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.upd textarea{display:block;width:100%;min-height:58px;resize:vertical;font:inherit;border:1px solid var(--edge);border-radius:10px;padding:9px;background:var(--bg);color:var(--ink);box-sizing:border-box;margin-top:6px}
.upd .row{display:flex;align-items:center;gap:10px;margin-top:8px}
.upd .send{margin-left:auto;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:8px 16px;font:inherit;font-weight:600}
.upd .inst li{display:flex;align-items:center;gap:10px}
.upd .inst .t{flex:1}
.upd .inst .go,.upd .inst .ok{border:1px solid var(--edge);background:var(--press);color:var(--ink);border-radius:10px;padding:7px 11px;font:inherit;font-size:.85rem;font-weight:600;text-decoration:none;white-space:nowrap}
.upd .inst li.done .t{color:var(--faint);text-decoration:line-through}
.upd .inst li.done .ok{background:var(--accent);border-color:var(--accent);color:#fff}
.upd .end{text-align:center;color:var(--dim);margin:26px 0 8px;font-family:var(--serif)}
`;
function styleOnce() {
  if (document.getElementById("upd-css")) return;
  const s = document.createElement("style");
  s.id = "upd-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// one writing box: prefix + text into the Desk queue, remembered locally so the
// page shows what he wrote before the laptop has filed it
function writeBox(title, hint, prefix, storeKey) {
  const c = el("section", { class: "card" });
  c.appendChild(el("h2", {}, esc(title)));
  c.appendChild(el("div", { class: "dim" }, esc(hint)));
  const sent = lsGet(storeKey, "");
  const ta = document.createElement("textarea");
  ta.placeholder = "Type or dictate";
  ta.value = "";
  const row = el("div", { class: "row" });
  const stat = el("span", { class: "dim" }, sent ? "Saved: " + esc(sent) : "");
  const b = el("button", { type: "button", class: "send" }, "Save");
  b.addEventListener("click", () => {
    const t = ta.value.trim();
    if (!t) return;
    if (queueDesk(prefix + " " + t, "#/update") === false) { stat.textContent = "Could not save on this phone."; return; }
    lsSet(storeKey, t);
    stat.innerHTML = "Saved: " + esc(t);
    ta.value = "";
  });
  row.appendChild(stat);
  row.appendChild(b);
  c.appendChild(ta);
  c.appendChild(row);
  return c;
}

function render(d, note, empty) {
  if (!isTab("update")) return;
  styleOnce();
  root.innerHTML = "";
  const page = el("div", { class: "upd" });
  const head = el("header", {});
  head.appendChild(el("div", { class: "eyebrow" }, "🔮 crystal · update"));
  head.appendChild(el("h1", {}, "Daily Update"));
  if (d && d.date) head.appendChild(el("div", { class: "strap" }, esc(fmtDay(d.date))));
  page.appendChild(head);
  if (note) page.appendChild(el("div", { class: "dim" }, esc(note)));

  const today = todayIso();
  const evening = new Date().getHours() >= 15;
  const tomorrowKey = "upd.plan." + today;   // tonight's plan for tomorrow
  const didKey = "upd.did." + today;

  if (!d || empty) {
    page.appendChild(emptyState("🌅", "No update yet", "The first one builds tomorrow morning. Tonight, write tomorrow's point below."));
  } else {
    // David 11/26: "having things on crystal to do instead of instagram". First on the
    // page, because a free moment is when he opens it. Done greys a row here and tells
    // the laptop (Desk queue) so tomorrow's picks move on.
    if (d.instead && d.instead.length) {
      const c = el("section", { class: "card inst" });
      c.appendChild(el("h2", {}, "Free moment? Do one"));
      const ul = el("ul", {});
      d.instead.forEach((x, n) => {
        const dk = "upd.inst." + d.date + "." + n;
        const li = el("li", { class: lsGet(dk, "") ? "done" : "" });
        li.appendChild(el("div", { class: "t" }, esc(x.text) + (x.mins ? ' <span class="dim">' + x.mins + " min</span>" : "")));
        if (x.link && /^https:\/\//.test(x.link)) {
          const a = el("a", { class: "go", href: x.link, target: "_blank", rel: "noopener" }, "Open");
          li.appendChild(a);
        }
        const b = el("button", { type: "button", class: "ok" }, "Done");
        b.addEventListener("click", () => {
          if (lsGet(dk, "")) return;
          if (queueDesk("instead done " + x.text, "#/update") === false) return;
          lsSet(dk, "1");
          li.classList.add("done");
        });
        li.appendChild(b);
        ul.appendChild(li);
      });
      c.appendChild(ul);
      page.appendChild(c);
    }

    // today's point
    const pt = el("section", { class: "card" });
    pt.appendChild(el("div", { class: "lab" }, "Today's point"));
    const mine = d.date === today ? d.point && d.point.today : "";
    pt.appendChild(el("div", { class: "point" }, mine ? esc(mine) : "None written last night."));
    if (d.point && d.point.yesterday) {
      pt.appendChild(el("div", { class: "lab" }, "Yesterday's goal"));
      pt.appendChild(el("div", {}, esc(d.point.yesterday)));
      pt.appendChild(el("div", { class: "lab" }, "What you did"));
      pt.appendChild(el("div", {}, d.point.did ? esc(d.point.did) : '<span class="dim">No look back written.</span>'));
    }
    if (d.ig && d.ig.reached) {
      pt.appendChild(el("div", { class: "dim", style: "margin-top:8px" },
        "Reached for Instagram " + d.ig.reached + (d.ig.reached === 1 ? " time" : " times") + " yesterday, went back to the point " + d.ig.back + "."));
    }
    page.appendChild(pt);
    if (d.headline) page.appendChild(el("p", { class: "lede" }, esc(d.headline)));
    if (d.note) page.appendChild(el("div", { class: "dim" }, esc(d.note)));

    // decide first: it is the only part that waits on him
    if (d.decide && d.decide.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "Needs you"));
      const ul = el("ul", {});
      d.decide.forEach((x) => ul.appendChild(el("li", {}, esc(x.q) + (x.who ? ' <span class="dim">' + esc(x.who) + "</span>" : ""))));
      c.appendChild(ul);
      c.appendChild(el("div", { class: "dim" }, "Answer in the head chat, or tap the mirror and say it."));
      page.appendChild(c);
    }

    if (d.moved && d.moved.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "What moved"));
      const ul = el("ul", {});
      d.moved.forEach((m) => ul.appendChild(el("li", {}, '<span class="lane">' + esc(m.lane) + "</span>" + esc(m.text))));
      c.appendChild(ul);
      page.appendChild(c);
    }

    if (d.answers && d.answers.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "Your questions"));
      const ul = el("ul", {});
      d.answers.forEach((a) => {
        const li = el("li", {});
        li.appendChild(el("div", { class: "q" }, esc(a.q)));
        li.appendChild(el("div", { class: "a" }, esc(a.a)));
        if (a.on) li.appendChild(el("div", { class: "dim" }, "On: " + esc(a.on)));
        ul.appendChild(li);
      });
      c.appendChild(ul);
      if (d.pendingQuestions) c.appendChild(el("div", { class: "dim" }, d.pendingQuestions + " still being answered."));
      page.appendChild(c);
    }

    if (d.ideas && d.ideas.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "Ideas to improve your systems"));
      c.appendChild(el("div", { class: "dim" }, "Yes means Claude builds it. Production deploys, sends and money still ask you."));
      const ul = el("ul", {});
      d.ideas.forEach((i) => {
        const li = el("li", {});
        li.appendChild(el("div", { class: "q" }, esc(i.text)));
        if (i.why) li.appendChild(el("div", { class: "dim" }, "Why: " + esc(i.why)));
        if (i.how) li.appendChild(el("div", { class: "dim" }, "On yes: " + esc(i.how)));
        const vk = "upd.vote." + i.id;
        const v = el("div", { class: "vote" });
        ["yes", "no"].forEach((ans) => {
          const b = el("button", { type: "button", class: lsGet(vk, "") === ans ? "on" : "" }, ans === "yes" ? "Yes" : "No");
          b.addEventListener("click", () => {
            if (queueDesk("idea " + ans + " " + i.id, "#/update") === false) return;
            lsSet(vk, ans);
            v.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
          });
          v.appendChild(b);
        });
        li.appendChild(v);
        ul.appendChild(li);
      });
      c.appendChild(ul);
      page.appendChild(c);
    }

    // what autofix did with the app lines of his Morning report
    if (d.asked && d.asked.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "You asked, autofix did"));
      const ul = el("ul", {});
      d.asked.forEach((a) => {
        const li = el("li", {});
        li.appendChild(el("div", { class: "q" }, '<span class="lane">' + esc(a.app) + "</span>" + esc(a.asked)));
        li.appendChild(el("div", { class: "a" }, esc(a.did)));
        ul.appendChild(li);
      });
      c.appendChild(ul);
      page.appendChild(c);
    }

    if (d.voted && d.voted.length) {
      const c = el("section", { class: "card" });
      c.appendChild(el("h2", {}, "You said"));
      const ul = el("ul", {});
      d.voted.forEach((i) => ul.appendChild(el("li", {}, '<span class="lane">' + (i.vote === "yes" ? "yes" : "no") + "</span>" + esc(i.text))));
      c.appendChild(ul);
      page.appendChild(c);
    }
  }

  // David 11/27: "after i read the morning update i should give a morning report ...
  // and in there i can give certain targeted instructions for the autofix."
  if (d && !empty) {
    const r = d.reports;
    page.appendChild(writeBox("Morning report",
      "Your thoughts after reading, under 2 minutes. Start a line with an app name for autofix "
      + '("tally: make the score buttons bigger"), it runs at 2:00 pm. "tally plan: ..." sets a standing plan.'
      + (r && r.of ? " Filed " + r.filed + " of the last " + r.of + " days." : ""),
      "report:", "upd.report." + today));
  }

  // the night-before loop: always at the foot, the main event after 3 pm
  if (evening) {
    page.appendChild(writeBox("How did today go?", "What you did against today's point, and one line on why.", "did:", didKey));
    page.appendChild(writeBox("Tomorrow's point", "One goal for tomorrow and the very first step. Then dead spot: when tomorrow's free stretch is and what fills it. Under 3 minutes.", "plan:", tomorrowKey));
  } else {
    page.appendChild(writeBox("Change today's point", "Only if last night's no longer fits.", "plan:", "upd.replan." + today));
  }

  const o = d && d.opens;
  page.appendChild(el("p", { class: "end" }, "That is the update." + (o && o.of ? " Opened " + o.opened + " of the last " + o.of + " mornings." : "")));
  page.appendChild(appFooter(() => open([], true)));
  root.appendChild(page);
}

export function open(parts, force) {
  loadCached("/update", "crystal.update", render, force);
}
