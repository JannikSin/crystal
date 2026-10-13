// Self-check for the /file route (standby, 2026-10-10): node tools/test_file_route.mjs
// Runs the real Worker module against an in-memory KV, with both keys.
import worker from "../worker/src/index.js";

const kv = new Map();
const STORE = {
  get: async (k, type) => {
    const v = kv.get(k);
    if (v === undefined) return null;
    return type === "arrayBuffer" ? v : v;
  },
  put: async (k, v) => { kv.set(k, v); },
  delete: async (k) => { kv.delete(k); },
};
const env = { STORE, BRIEF_KEY: "laptop-key-0123456789", PHONE_KEY: "phone-key-0123456789" };
const W = "https://crystal-brief.janniksin.workers.dev";
let fails = 0;
const check = (label, ok) => { if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + label); };
const call = (method, path, key, extra = {}) =>
  worker.fetch(new Request(W + path, { method, headers: { "x-brief-key": key, ...(extra.headers || {}) }, body: extra.body }), env);

const pdf = new TextEncoder().encode("%PDF-1.7 test bytes");
const meta = JSON.stringify({ title: "ME 274 HW7 solutions", name: "HW7.pdf", made: "Sat 10/10, 12:45 am" });
const post = (key, id = "hw7-solutions", type = "application/pdf", m = meta) =>
  call("POST", "/file?id=" + id, key, { headers: { "content-type": type, "x-file-meta": m }, body: pdf });

check("laptop push accepted", (await post(env.BRIEF_KEY)).status === 200);
check("phone cannot push", (await post(env.PHONE_KEY)).status === 403);
check("wrong type refused", (await post(env.BRIEF_KEY, "x-file", "text/html")).status === 415);
check("title required", (await post(env.BRIEF_KEY, "y-file", "application/pdf", "{}")).status === 400);
check("bad id refused", (await post(env.BRIEF_KEY, "../etc")).status === 400);

const idx = await (await call("GET", "/file", env.PHONE_KEY)).json();
check("phone reads the index", idx.items.length === 1 && idx.items[0].title === "ME 274 HW7 solutions");
check("index carries type and size", idx.items[0].type === "application/pdf" && idx.items[0].bytes === pdf.byteLength);

const r = await call("GET", "/file?id=hw7-solutions", env.PHONE_KEY);
const back = new Uint8Array(await r.arrayBuffer());
check("phone reads the bytes, typed", r.status === 200 && r.headers.get("content-type") === "application/pdf" && back.length === pdf.length);
check("missing id is 404", (await call("GET", "/file?id=nope", env.PHONE_KEY)).status === 404);
check("phone cannot delete", (await call("DELETE", "/file?id=hw7-solutions", env.PHONE_KEY)).status === 403);
check("no key is 401", (await call("GET", "/file", "")).status === 401);

await post(env.BRIEF_KEY);   // same id again replaces, never duplicates
const idx2 = await (await call("GET", "/file", env.PHONE_KEY)).json();
check("re-push replaces the row", idx2.items.length === 1);
check("laptop deletes", (await call("DELETE", "/file?id=hw7-solutions", env.BRIEF_KEY)).status === 200);
check("gone after delete", (await call("GET", "/file?id=hw7-solutions", env.PHONE_KEY)).status === 404);

console.log("selftest:", fails ? fails + " FAIL" : "PASS");
process.exit(fails ? 1 : 0);
