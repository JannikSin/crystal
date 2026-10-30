// Self-check for markRead while a flush is in flight. The pump sends q[0] and
// shifts it by position when the answer lands, so ids merged into that item
// mid-send were dropped and never reached /newsread. markRead must leave the
// in-flight head alone and queue a fresh item, the exemption setTick carries.
//
//     node tools/test_markread.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.document = { getElementById: () => null };
globalThis.window = { addEventListener() {} };
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const nav = { onLine: true };
Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });

const sent = [];
let answer = null;
globalThis.fetch = (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return new Promise((res) => { answer = res; });
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const { markRead } = await import("../sync.js");
const date = "2026-10-30";

markRead(date, ["a"]);
assert.equal(sent.length, 1, "the first id goes out at once");
assert.deepEqual(sent[0].body, { date, ids: ["a"] });

// "b" is read while "a" is still on the wire
markRead(date, ["b"]);
const q = JSON.parse(store.get("brief.queue"));
assert.equal(q.length, 2, "the in-flight item is not edited; b gets its own");
assert.deepEqual(q[0].ids, ["a"]);
assert.deepEqual(q[1].ids, ["b"]);

answer({ ok: true, status: 200 });
await tick();
assert.equal(sent.length, 2, "b is sent after a lands");
assert.deepEqual(sent[1].body, { date, ids: ["b"] });

nav.onLine = false; // the empty queue then skips the IndexedDB upload pump
answer({ ok: true, status: 200 });
await tick();
assert.deepEqual(JSON.parse(store.get("brief.queue")), [], "queue drains");
assert.deepEqual(JSON.parse(store.get("crystal.read." + date)), ["a", "b"]);

console.log("sync.js: markRead in-flight check, all assertions passed");
