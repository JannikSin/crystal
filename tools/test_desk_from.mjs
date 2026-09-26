// Self-check for the ✎ sender name and the long-note rule on the Worker's
// Desk routes (terrigen, 2026-09-26). David: "want each note to know who sent
// it" and "dont cap a long voice note". An in-memory KV stands in for STORE.
//
//     node tools/test_desk_from.mjs
import assert from "node:assert/strict";

const { default: worker } = await import("../worker/src/index.js");

const kv = new Map();
const STORE = {
  async get(k, type) {
    const v = kv.get(k);
    if (v === undefined) return null;
    return type === "arrayBuffer" ? v : v;
  },
  async put(k, v) { kv.set(k, v); },
  async delete(k) { kv.delete(k); },
  async list({ prefix }) {
    return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  },
};
const env = { STORE, BRIEF_KEY: "laptop-test-key", PHONE_KEY: "phone-test-key" };
const W = "https://crystal-brief.example";
const OPEN = { origin: "https://janniksin.github.io", "content-type": "application/json" };

async function post(body, headers = OPEN) {
  const r = await worker.fetch(new Request(W + "/desk", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  return { status: r.status, body: await r.json() };
}
const stored = (id) => JSON.parse(kv.get("desk:" + id));

// ---------- a name rides along and is stored as `from` ----------
let r = await post({ app: "tally", route: "game/euchre", text: "bigger pad", from: "  Elliot  " });
assert.equal(r.status, 200);
assert.equal(stored(r.body.id).from, "Elliot");
assert.equal(stored(r.body.id).via, "open");

// ---------- markup and newlines in the name are stripped, length capped ----------
r = await post({ app: "tally", text: "x", from: "**Dad**\n[[System/Protocol]] <b>`" + "z".repeat(80) });
const f = stored(r.body.id).from;
assert.ok(!/[\[\]`*<>\n]/.test(f), "markup survived in from: " + f);
assert.ok(f.length <= 40);
assert.ok(f.startsWith("Dad System/Protocol b"), f);

// ---------- no name: no from field (the drain decides guest vs David) ----------
r = await post({ app: "tally", text: "no name" });
assert.equal(stored(r.body.id).from, undefined);

// ---------- a long keyed transcript is NOT clipped at 8000 chars ----------
const long = "word ".repeat(6000).trim();          // 30,000 chars, about 35 minutes spoken
r = await post({ app: "mise", text: long, from: "David" },
  { "x-brief-key": "laptop-test-key", "content-type": "application/json" });
assert.equal(r.status, 200);
assert.equal(stored(r.body.id).text.length, long.length, "long voice note was clipped");

// ---------- the same long note keyless still fits under 64 KB ----------
r = await post({ app: "mise", text: long });
assert.equal(stored(r.body.id).text.length, long.length);

// ---------- keyless over 64 KB is still a 200 that stores nothing ----------
r = await post({ app: "mise", text: "y".repeat(70 * 1024) });
assert.equal(r.status, 200);
assert.equal(r.body.ok, false);

// ---------- /deskaudio carries from in its meta ----------
const ar = await worker.fetch(new Request(W + "/deskaudio?app=bonmot&route=review&from=Dad", {
  method: "POST", headers: { origin: "https://janniksin.github.io", "content-type": "audio/mp4" },
  body: new Uint8Array([1, 2, 3, 4]),
}), env);
assert.equal(ar.status, 200);
const aid = (await ar.json()).id;
const meta = JSON.parse(kv.get("deskaudiometa:" + aid));
assert.equal(meta.from, "Dad");
assert.equal(meta.app, "bonmot");
assert.equal(meta.via, "open", "audio meta must say it came from a guest");

// ---------- the laptop GET hands `from` to the drain ----------
const g = await worker.fetch(new Request(W + "/desk", { headers: { "x-brief-key": "laptop-test-key" } }), env);
const notes = (await g.json()).notes;
assert.ok(notes.some((n) => n.from === "Elliot"));

console.log("desk from checks passed");
