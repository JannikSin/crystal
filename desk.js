// desk.js: the Desk board, rendered at the foot of the Today tab (the Desk TAB
// is gone, David 2026-08-17: the floating bubble is the write side everywhere,
// and a captured fix is a thing for TODAY, so the read side lives there too).
// This module keeps the derived board the laptop pushes, with approve for
// tickets sitting in review.
//
// The approve secret is typed per session and held in a module variable only:
// no localStorage, no IndexedDB, no remember-me. It defends the key at rest;
// script running in this page can still read it at submit, which is the
// recorded residual (Desk.md Part 11).
//
// Everything ticket-derived renders through textContent, never through el()'s
// innerHTML arg: titles start life as phone notes run through a model, and an
// injected tag here sits next to the approve secret field.

import { el, fmtBuilt, WORKER, key, isTab } from "./core.js";

let approveSecret = ""; // session-only, never persisted
const actedLocally = new Set(); // ids approved/rejected this session; the board
                                // lags up to an hour, so suppress a second tap

const STATE_LABEL = {
  new: "waiting for the drain",
  triaged: "sorted, waiting",
  working: "being worked",
  review: "ready for your tap",
  "needs-you": "needs the laptop",
  done: "filed",
  stuck: "stuck, needs a look",
  rejected: "not actioned",
  parked: "parked",
};

// el() sets innerHTML; this is the safe twin for untrusted strings
function txt(tag, attrs, text) {
  const e = el(tag, attrs);
  e.textContent = text;
  return e;
}

function approveControls(t, onDone) {
  const row = el("div", { class: "row" });
  const stat = el("span", { class: "stat" }, "");
  const secret = document.createElement("input");
  secret.type = "password";
  secret.placeholder = "approve secret";
  // current-password lets the iOS password manager offer the value inline
  // instead of forcing an app-switch that reloads the PWA and wipes the
  // session secret (Usability).
  secret.autocomplete = "current-password";
  secret.value = approveSecret;
  const send = (approve) => {
    approveSecret = secret.value; // session only
    if (!approveSecret) { stat.textContent = "secret required"; return; }
    fetch(WORKER + "/deskapprove", {
      method: "POST",
      headers: { "content-type": "application/json", "x-brief-key": key() },
      body: JSON.stringify({ id: t.id, approve, secret: approveSecret }),
    }).then((r) => {
      if (r.ok) {
        // the board only changes when the laptop drain next pushes it, up to
        // an hour out, so remember locally and repaint the card without the
        // Approve button rather than invite a second tap (Usability)
        actedLocally.add(t.id + ":" + (approve ? "y" : "n"));
        actedLocally.add(t.id);
        onDone();
      } else if (r.status === 403) stat.textContent = "wrong secret";
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
  if (t.triage === "default")
    card.appendChild(txt("p", { class: "hint" },
      "filed without the model (budget was spent); it re-sorts on the next funded drain"));
  if (t.model || t.score != null)
    card.appendChild(txt("p", { class: "hint" },
      "score " + (t.score == null ? "?" : t.score) + " -> " + (t.model || "?")));
  if (t.coverage) card.appendChild(txt("p", { class: "hint" }, t.coverage));
  (t.checks || []).forEach((c) => {
    card.appendChild(txt("p", { class: "hint" },
      (c.ok ? "✓ " : "✗ ") + c.cmd + (c.ranAgainst ? " @ " + String(c.ranAgainst).slice(0, 7) : "")));
  });
  if (t.state === "review" && actedLocally.has(t.id)) {
    card.appendChild(txt("p", { class: "hint" },
      actedLocally.has(t.id + ":y") ? "approved, the laptop will pick it up"
        : "rejected, the laptop will pick it up"));
  } else if (t.state === "review" && t.diff && !t.diffTruncated) {
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

// The section Today appends at its foot. Returns an empty, self-filling
// container: an empty or unreachable board renders NOTHING, because the Today
// screen's whole doctrine is minimal, and a "board empty" line every day is
// noise about work that does not exist.
export function boardSection() {
  const sec = el("div", {});
  const paint = () => {
    fetch(WORKER + "/desk", { headers: { "x-brief-key": key() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((board) => {
        if (!isTab("today")) return;
        sec.innerHTML = "";
        if (!board || !Array.isArray(board.tickets) || !board.tickets.length) return;
        sec.appendChild(el("h2", { class: "deskhead" }, "🗃️ On the desk"));
        board.tickets.forEach((t) => sec.appendChild(ticketCard(t, paint)));
        if (board.built) sec.appendChild(el("p", { class: "hint" }, fmtBuilt(board.built)));
      })
      .catch(() => {});
  };
  paint();
  return sec;
}
