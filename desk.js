// desk.js: the idea inbox. Zero decisions at capture time: one box, one Send,
// and the note is on its way to the hourly drain. Below it, the derived board
// the laptop pushes, with approve for tickets sitting in review.
//
// The approve secret is typed per session and held in a module variable only:
// no localStorage, no IndexedDB, no remember-me. It defends the key at rest;
// script running in this page can still read it at submit, which is the
// recorded residual (Desk.md Part 11).
//
// Everything ticket-derived renders through textContent, never through el()'s
// innerHTML arg: titles start life as phone notes run through a model, and an
// injected tag here sits next to the approve secret field.

import { root, el, lsGet, todayIso, fmtBuilt, appFooter, WORKER, key, isTab } from "./core.js";
import { queueDesk } from "./sync.js";

let approveSecret = ""; // session-only, never persisted

const STATE_LABEL = {
  new: "waiting for the drain",
  triaged: "triaged",
  working: "working",
  review: "ready for your tap",
  "needs-you": "needs the laptop",
  done: "done",
  stuck: "stuck",
  rejected: "rejected",
  parked: "parked",
};

// el() sets innerHTML; this is the safe twin for untrusted strings
function txt(tag, attrs, text) {
  const e = el(tag, attrs);
  e.textContent = text;
  return e;
}

function renderCapture() {
  const box = el("section", { class: "capture" });
  box.appendChild(el("h2", {}, "🗃️ The Desk"));
  box.appendChild(el("p", { class: "hint" },
    "Drop the idea and keep walking. The hourly drain sorts out what it is."));
  const ta = document.createElement("textarea");
  ta.rows = 3;
  ta.placeholder = "the Money dial is showing two dashes for TOST...";
  box.appendChild(ta);
  const row = el("div", { class: "row" });
  const stat = el("span", { class: "stat" }, "");
  const send = el("button", { type: "button", class: "send" }, "Send");
  const list = el("ul", { class: "caplist", id: "desklist" });
  const paint = () => {
    list.innerHTML = "";
    lsGet("desk.notes." + todayIso(), []).slice(-6).reverse().forEach((n) => {
      list.appendChild(txt("li", {}, (n.sent ? "✓ " : "· ") + n.text));
    });
  };
  list.addEventListener("desk-changed", paint);
  send.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) return;
    queueDesk(text);
    ta.value = "";
    stat.textContent = "on the desk";
    setTimeout(() => { stat.textContent = ""; }, 2500);
    paint();
  });
  row.appendChild(send);
  row.appendChild(stat);
  box.appendChild(row);
  box.appendChild(list);
  paint();
  return box;
}

function approveControls(t, onDone) {
  const row = el("div", { class: "row" });
  const stat = el("span", { class: "stat" }, "");
  const secret = document.createElement("input");
  secret.type = "password";
  secret.placeholder = "approve secret";
  secret.autocomplete = "off";
  secret.value = approveSecret;
  const send = (approve) => {
    approveSecret = secret.value; // session only
    if (!approveSecret) { stat.textContent = "secret required"; return; }
    fetch(WORKER + "/deskapprove", {
      method: "POST",
      headers: { "content-type": "application/json", "x-brief-key": key() },
      body: JSON.stringify({ id: t.id, approve, secret: approveSecret }),
    }).then((r) => {
      if (r.ok) { stat.textContent = approve ? "approved" : "rejected"; onDone(); }
      else if (r.status === 403) stat.textContent = "wrong secret";
      else stat.textContent = "not sent (" + r.status + ")";
    }).catch(() => { stat.textContent = "no signal"; });
  };
  const ok = el("button", { type: "button", class: "send" }, "Approve");
  const no = el("button", { type: "button" }, "Reject");
  ok.addEventListener("click", () => send(true));
  no.addEventListener("click", () => send(false));
  row.appendChild(secret);
  row.appendChild(ok);
  row.appendChild(no);
  row.appendChild(stat);
  return row;
}

function ticketCard(t, repaint) {
  const card = el("section", { class: "capture" });
  card.appendChild(txt("div", { class: "eyebrow" },
    (t.intent || "?") + " · " + (t.target || "?") + " · " + (STATE_LABEL[t.state] || t.state)));
  card.appendChild(txt("h2", {}, t.title || t.id));
  if (t.model || t.score != null)
    card.appendChild(txt("p", { class: "hint" },
      "score " + (t.score == null ? "?" : t.score) + " -> " + (t.model || "?")));
  if (t.coverage) card.appendChild(txt("p", { class: "hint" }, t.coverage));
  (t.checks || []).forEach((c) => {
    card.appendChild(txt("p", { class: "hint" },
      (c.ok ? "✓ " : "✗ ") + c.cmd + (c.ranAgainst ? " @ " + String(c.ranAgainst).slice(0, 7) : "")));
  });
  if (t.state === "review" && t.diff && !t.diffTruncated) {
    const pre = document.createElement("pre");
    pre.style.overflowX = "auto";
    pre.textContent = t.diff; // the raw diff IS the perimeter; never marked up
    card.appendChild(pre);
    card.appendChild(approveControls(t, repaint));
  } else if (t.state === "review" && t.diffTruncated) {
    // an over-cap diff is not approvable from the phone, by design
    card.appendChild(el("p", { class: "hint" },
      "diff over the cap: read it on the laptop, this one has no approve button"));
  }
  if (t.answer) card.appendChild(txt("p", {}, t.answer));
  return card;
}

export function open() {
  root.appendChild(renderCapture());
  const holder = el("div", {});
  const paint = () => {
    fetch(WORKER + "/desk", { headers: { "x-brief-key": key() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((board) => {
        if (!isTab("desk")) return;
        holder.innerHTML = "";
        if (!board || !Array.isArray(board.tickets) || !board.tickets.length) {
          holder.appendChild(el("p", { class: "hint" },
            board && board.built ? "board empty · " + fmtBuilt(board.built) : "no board yet"));
          return;
        }
        board.tickets.forEach((t) => holder.appendChild(ticketCard(t, paint)));
        if (board.built) holder.appendChild(el("p", { class: "hint" }, fmtBuilt(board.built)));
      })
      .catch(() => {
        if (isTab("desk")) holder.appendChild(el("p", { class: "hint" }, "board unreachable"));
      });
  };
  root.appendChild(holder);
  root.appendChild(appFooter(paint));
  paint();
}
