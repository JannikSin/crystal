// Self-check for /clock and /clockconfig (staircase, 2026-11-09): node tools/test_clock_route.mjs
// Runs the real Worker module against an in-memory KV, with both keys.
import worker from "../worker/src/index.js";

const kv = new Map();
const STORE = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, v) => { kv.set(k, v); },
  delete: async (k) => { kv.delete(k); },
};
const env = { STORE, BRIEF_KEY: "laptop-key-0123456789", PHONE_KEY: "phone-key-0123456789" };
const W = "https://crystal-brief.janniksin.workers.dev";
let fails = 0;
const check = (label, ok) => { if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + label); };
const call = (method, path, key, body) =>
  worker.fetch(new Request(W + path, { method, headers: { "x-brief-key": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }), env);

const snap = {
  date: "2026-11-09", tz: -300, start: { cat: "sleep", sub: "", at: 1 },
  events: [{ at: 100, cat: "purpl", sub: "" }, { at: 200, cat: "hw", sub: "PHYS 310" },
    { at: "junk", cat: "x" }, { at: 300, cat: "" }],
  ig: 42,
};
let r = await call("POST", "/clock", env.PHONE_KEY, snap);
check("phone posts a day", r.status === 200);
check("bad rows dropped, not refused", (await r.json()).events === 2);
r = await call("POST", "/clock", env.PHONE_KEY, { ...snap, events: [{ at: 50, cat: "gym" }] });
check("a later post replaces the day", JSON.parse(kv.get("clock:2026-11-09")).events.length === 1);
check("no date is a 400", (await call("POST", "/clock", env.PHONE_KEY, { events: [] })).status === 400);
check("ig out of range becomes null", (await (await call("POST", "/clock", env.PHONE_KEY, { ...snap, date: "2026-11-10", ig: 99999 })).json()).ok
  && JSON.parse(kv.get("clock:2026-11-10")).ig === null);
check("ig null stays null", (await call("POST", "/clock", env.PHONE_KEY, { ...snap, date: "2026-11-11", ig: null })).status === 200
  && JSON.parse(kv.get("clock:2026-11-11")).ig === null);

r = await call("GET", "/clock?from=2026-11-08&to=2026-11-12", env.BRIEF_KEY);
const got = await r.json();
check("laptop reads a range, missing days skipped", r.status === 200 && got.days.map((d) => d.date).join() === "2026-11-09,2026-11-10,2026-11-11");
check("range across a month end", (await (await call("GET", "/clock?from=2026-10-30&to=2026-11-02", env.BRIEF_KEY)).json()).days.length === 0);
check("single day by date", (await (await call("GET", "/clock?date=2026-11-09", env.PHONE_KEY)).json()).days.length === 1);
check("no dates is a 400", (await call("GET", "/clock", env.BRIEF_KEY)).status === 400);

check("config default is empty", (await (await call("GET", "/clockconfig", env.PHONE_KEY)).json()).courses.length === 0);
check("phone cannot write config", (await call("POST", "/clockconfig", env.PHONE_KEY, { courses: ["X"] })).status === 403);
check("laptop writes config", (await call("POST", "/clockconfig", env.BRIEF_KEY, { cats: null, courses: ["PHYS 310"] })).status === 200);
check("phone reads config", (await (await call("GET", "/clockconfig", env.PHONE_KEY)).json()).courses[0] === "PHYS 310");
check("bad cats refused", (await call("POST", "/clockconfig", env.BRIEF_KEY, { cats: "no" })).status === 400);
check("no key is 401", (await call("GET", "/clock?date=2026-11-09", "")).status === 401);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
