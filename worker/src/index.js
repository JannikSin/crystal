// crystal-brief Worker: private relay between a laptop and a phone.
// The public Pages app (janniksin.github.io/crystal) is an empty shell; every
// byte of content lives here in KV, behind one secret key (BRIEF_KEY).
//
// Brief (unchanged since v1):
//   POST /brief            laptop pushes the day's brief JSON   {date, ...}
//   GET  /brief[?date=]    app fetches latest (or a date; history)
//   POST /ticks            app pushes one checkbox delta        {date, id, done, ...}
//   GET  /ticks?date=      laptop pulls a day's tick state
//   POST /capture          app pushes a free-text note          {date, text, at}
//   GET  /capture?date=    laptop pulls a day's captures
//
// Crystal v3 additions:
//   POST /news             laptop pushes the day's news edition (validated)
//   GET  /news[?date=]     app fetches latest edition (or a date)
//   POST /newsread         app marks stories read {date, ids[]}; merged union
//   GET  /newsread?date=   read set for a date
//   POST /markets          laptop pushes the evening digest {date, built, sections[]}
//   GET  /markets[?date=]  latest digest (or a date)
//   POST /holdings         laptop pushes portfolio truth (validated) -> holdings:latest
//   GET  /holdings         the portfolio
//   GET  /quotes?symbols=A,B          live-ish prices, 15-min KV cache per symbol
//   GET  /quotehistory?symbol=&range= daily closes, range 1d|1w|1m|max, cached
//
// Quotes provider: Yahoo Finance v8 chart endpoint (no key needed), with
// Stooq CSV as automatic fallback. Failure modes: Yahoo is unofficial and can
// rate-limit datacenter IPs (429/999) or change shape; Stooq is 15-min delayed,
// daily-granularity only (so no intraday 1d series from it), and wants a .us
// suffix on US symbols. Every provider failure degrades to the last cached
// value with stale:true; these endpoints never 500 the app.
//
// Crystal v4 additions:
//   POST /scan?date=          phone uploads the handwritten list, raw JPEG bytes
//   GET  /scan?date=          that JPEG back, image/jpeg
//   POST /answer?date=&qid=   phone uploads one spoken answer, raw audio bytes
//   GET  /answer?date=        index of that day's answers        (laptop only)
//   GET  /answer?date=&qid=   the audio bytes                    (laptop only)
//   DELETE /answer?date=&qid= transcriber drops audio once it has the text
//   POST /feedback            laptop pushes graded answers (validated)
//   GET  /feedback?date=      the grades for a date
//   POST /listen              laptop pushes the queue (validated)
//   GET  /listen              the queue
//   POST /career              laptop pushes roster + outreach (validated)
//   GET  /career              the roster
//
// Desk additions (the idea inbox; Crystal System/Desk.md):
//   POST /desk               phone or laptop drops a note; one KV key per note
//                            (desk:<id>); never 4xx except 401
//   GET  /desk               phone: the derived board; laptop: board + raw notes
//   DELETE /desk?id=         laptop drain consumes a note after filing it
//   POST /deskapprove        phone approves ticket <id> with the approve secret
//                            (DESK_APPROVE_KEY, never persisted client-side)
//   GET  /deskapprove        drain polls approvals
//   POST /deskboard          laptop pushes the derived board
//
// scan:/answer:/feedback: keys carry a 14 day expirationTtl. Nothing else does,
// because the vault merge depends on pulling ticks and captures on its own clock.
// Media never rides inside JSON: those routes take raw bytes, no base64.
//
// Auth: x-brief-key header only, no query param. Two roles. BRIEF_KEY (laptop)
// does everything. PHONE_KEY does GET on any payload route plus POST on
// ticks/capture/newsread/scan/answer. It never pushes a payload, never reads or
// deletes /answer. BRIEF_KEYS / PHONE_KEYS take comma separated sets so a key
// can rotate without a window of 401s.
// ponytail: single-user KV read-modify-write on /ticks, /newsread and the
// answer index; last write wins. Fine for one phone; a Durable Object if a
// second writer appears.

import {
  validateNews,
  validateMarkets,
  validateHoldings, validateLibrary, validateMoves,
  validateBriefV2,
  validateListen,
  validateCareer,
  validateShopping,
  validateFeedback,
  DATE_RE,
  TICKER_RE,
  ID_RE,
} from "./validate.js";

const ORIGIN = "https://janniksin.github.io";
const CORS = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-headers": "content-type, x-brief-key",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  vary: "origin",
};
const MAX_BODY = 1024 * 1024;
// encoded caps per route, checked on content-length before anything is read
const BODY_CAP = { "/scan": 2 * 1024 * 1024, "/answer": 6 * 1024 * 1024 };
const BLOB_TTL = 14 * 24 * 3600;
const DESK_TTL = 30 * 24 * 3600; // backstop for un-drained desk: / deskapprove: keys
const AUDIO_TYPES = ["audio/mp4", "audio/m4a", "audio/aac", "audio/webm"];
const QUOTE_TTL = 15 * 60 * 1000;
const HIST_TTL = 24 * 60 * 60 * 1000;
const INTRADAY_TTL = 15 * 60 * 1000;

// nosniff on every body: nothing here is ever meant to be re-typed by a
// browser, and the blob routes hand back bytes a phone uploaded.
const NOSNIFF = "x-content-type-options";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", [NOSNIFF]: "nosniff", ...CORS },
  });
}

function raw200(text) {
  return new Response(text, {
    headers: { "content-type": "application/json", "cache-control": "no-store", [NOSNIFF]: "nosniff", ...CORS },
  });
}

// ---------- auth: two roles, constant-time compare, header only ----------

// BRIEF_KEY plus the comma separated BRIEF_KEYS rotation set, same for phone
function keySet(env, ...names) {
  const out = [];
  for (const n of names)
    for (const part of String(env[n] || "").split(",")) {
      const k = part.trim();
      if (k) out.push(k);
    }
  return out;
}

// XOR every char so a wrong key costs the same time as a nearly-right one.
// Length still short-circuits; key length is not the secret, the bytes are.
function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function role(request, env) {
  const k = request.headers.get("x-brief-key") || "";
  if (!k) return null;
  for (const b of keySet(env, "BRIEF_KEY", "BRIEF_KEYS")) if (sameKey(k, b)) return "laptop";
  for (const p of keySet(env, "PHONE_KEY", "PHONE_KEYS")) if (sameKey(k, p)) return "phone";
  return null;
}

// The phone reads everything it renders and writes only what the user taps.
// It never pushes a payload, never touches raw answer audio, never deletes.
const PHONE_POST = ["/ticks", "/capture", "/newsread", "/scan", "/answer", "/desk", "/deskapprove"];
function phoneAllowed(method, path) {
  if (method === "GET") return path !== "/answer";
  if (method === "POST") return PHONE_POST.includes(path);
  return false;
}

const clip = (v, n) => String(v ?? "").slice(0, n);

const capFor = (path) => BODY_CAP[path] || MAX_BODY;

// content-length is the cheap gate: refuse before a byte is read. Bodies that
// arrive without one (chunked) still hit the post-read backstop below.
function overCap(request, cap) {
  const n = Number(request.headers.get("content-length") || 0);
  return n > cap;
}

async function readBody(request, cap = MAX_BODY) {
  if (overCap(request, cap)) return { err: json(413, { error: "too large" }) };
  const raw = await request.text();
  if (raw.length > cap) return { err: json(413, { error: "too large" }) };
  try {
    return { raw, body: JSON.parse(raw) };
  } catch {
    return { err: json(400, { error: "invalid JSON" }) };
  }
}

// Raw bytes in, same two gates, plus the declared content-type must be one we
// asked for. Returns {err} or {buf}.
async function readBlob(request, cap, types) {
  const ct = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!types.includes(ct)) return { err: json(415, { error: `content-type must be ${types.join("|")}` }) };
  if (overCap(request, cap)) return { err: json(413, { error: "too large" }) };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > cap) return { err: json(413, { error: "too large" }) };
  if (!buf.byteLength) return { err: json(400, { error: "empty body" }) };
  return { buf, ct };
}

function bytes200(buf, type) {
  return new Response(buf, {
    headers: { "content-type": type, "cache-control": "no-store", [NOSNIFF]: "nosniff", ...CORS },
  });
}

// Store under <prefix>:<date>, and under <prefix>:latest unless an older date
// is being backfilled (history must not clobber the phone's latest).
async function putDated(env, prefix, date, raw) {
  await env.STORE.put(`${prefix}:${date}`, raw);
  let latestDate = "";
  try {
    latestDate = JSON.parse((await env.STORE.get(`${prefix}:latest`)) || "{}").date || "";
  } catch {}
  if (date >= latestDate) await env.STORE.put(`${prefix}:latest`, raw);
}

async function getDated(env, prefix, qdate) {
  return env.STORE.get(qdate ? `${prefix}:${qdate}` : `${prefix}:latest`);
}

// One index per date so the laptop can list a day's answers without a KV list
// call. Expires with the audio it points at.
async function answerIndex(env, date) {
  try {
    const cur = JSON.parse((await env.STORE.get(`answeridx:${date}`)) || "{}");
    return Array.isArray(cur.items) ? cur.items : [];
  } catch {
    return [];
  }
}

async function putAnswerIndex(env, date, items) {
  await env.STORE.put(
    `answeridx:${date}`,
    JSON.stringify({ date, items, updated: new Date().toISOString() }),
    { expirationTtl: BLOB_TTL },
  );
}

// ---------- quotes: Yahoo primary, Stooq fallback, stale-serving cache ----------

async function yahooChart(sym, range, interval) {
  const u =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?range=${range}&interval=${interval}`;
  const r = await fetch(u, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; crystal-brief)", accept: "application/json" },
  });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || "yahoo empty result");
  return res;
}

function yahooPoints(res) {
  const ts = res.timestamp || [];
  const closes = res.indicators?.quote?.[0]?.close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof closes[i] === "number") pts.push({ t: ts[i] * 1000, c: closes[i] });
  }
  return pts;
}

function stooqSym(sym) {
  // US symbols need the .us suffix; anything with a dot already is left alone
  return sym.includes(".") ? sym.toLowerCase() : sym.toLowerCase() + ".us";
}

async function stooqDaily(sym, interval, d1) {
  let u = `https://stooq.com/q/d/l/?s=${stooqSym(sym)}&i=${interval}`;
  if (d1) u += `&d1=${d1}&d2=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`stooq ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split("\n").slice(1); // drop header
  const pts = [];
  for (const line of lines) {
    const cols = line.split(",");
    const c = parseFloat(cols[4]);
    const t = Date.parse(cols[0]);
    if (isFinite(c) && isFinite(t)) pts.push({ t, c });
  }
  if (!pts.length) throw new Error("stooq empty");
  return pts;
}

function daysAgoYmd(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchQuote(sym) {
  try {
    const res = await yahooChart(sym, "1d", "1d");
    const m = res.meta || {};
    if (typeof m.regularMarketPrice !== "number") throw new Error("yahoo no price");
    const prev = m.chartPreviousClose ?? m.previousClose;
    return {
      symbol: sym,
      price: m.regularMarketPrice,
      prevClose: typeof prev === "number" ? prev : null,
      currency: m.currency || "USD",
      marketTime: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
      source: "yahoo",
    };
  } catch (e) {
    const pts = await stooqDaily(sym, "d", daysAgoYmd(20));
    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    return {
      symbol: sym,
      price: last.c,
      prevClose: prev ? prev.c : null,
      currency: "USD",
      marketTime: last.t,
      source: "stooq-delayed",
    };
  }
}

async function fetchHistory(sym, range) {
  const yahooMap = {
    "1d": ["1d", "5m"],
    "1w": ["5d", "1d"],
    "1m": ["1mo", "1d"],
    max: ["max", "1wk"],
  };
  try {
    const [r, i] = yahooMap[range];
    const res = await yahooChart(sym, r, i);
    const pts = yahooPoints(res);
    if (!pts.length) throw new Error("yahoo no points");
    return { symbol: sym, range, points: pts, source: "yahoo" };
  } catch (e) {
    if (range === "1d") throw new Error("intraday unavailable: " + (e.message || e));
    const pts =
      range === "max"
        ? await stooqDaily(sym, "w")
        : await stooqDaily(sym, "d", daysAgoYmd(range === "1w" ? 14 : 45));
    return { symbol: sym, range, points: pts, source: "stooq-delayed" };
  }
}

// Serve from KV if younger than ttl; otherwise refetch; on refetch failure
// serve whatever is cached with stale:true. Never throws.
async function cachedFetch(env, key, ttl, fetcher) {
  let cur = null;
  try {
    cur = JSON.parse((await env.STORE.get(key)) || "null");
  } catch {}
  if (cur && cur.asOf && Date.now() - Date.parse(cur.asOf) < ttl) return cur;
  try {
    const fresh = await fetcher();
    const out = { ...fresh, asOf: new Date().toISOString(), stale: false };
    await env.STORE.put(key, JSON.stringify(out));
    return out;
  } catch (e) {
    if (cur) return { ...cur, stale: true };
    return { error: String((e && e.message) || e), stale: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const path = url.pathname;
    const method = request.method;

    const who = role(request, env);
    if (!who) return json(401, { error: "bad key" });
    if (who === "phone" && !phoneAllowed(method, path))
      return json(403, { error: "laptop key required for this route" });

    const qdate = url.searchParams.get("date") || "";
    // POST /desk must be incapable of any 4xx but 401 (sync.js drops the queue
    // head on any 4xx), so it is exempt from the shared bad-date gate; it
    // reads no date anyway.
    if (qdate && !DATE_RE.test(qdate) && !(path === "/desk" && method === "POST"))
      return json(400, { error: "bad date" });

    // ---------- brief ----------
    if (path === "/brief" && method === "GET") {
      const raw = await getDated(env, "brief", qdate);
      if (!raw) return json(404, { error: "no brief yet" });
      return raw200(raw);
    }

    if (path === "/brief" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      // v2 is the timeline payload and gets checked; v1 stays legacy and does not
      if (body?.v === 2) {
        const bad = validateBriefV2(body);
        if (bad) return json(400, { error: bad });
      } else if (!DATE_RE.test(body?.date || "")) {
        return json(400, { error: "brief.date required" });
      }
      await putDated(env, "brief", body.date, raw);
      return json(200, { ok: true, date: body.date, bytes: raw.length });
    }

    // ---------- ticks ----------
    if (path === "/ticks" && method === "GET") {
      if (!qdate) return json(400, { error: "date required" });
      const raw = await env.STORE.get(`ticks:${qdate}`);
      return raw200(raw || JSON.stringify({ date: qdate, items: {} }));
    }

    if (path === "/ticks" && method === "POST") {
      const { body, err } = await readBody(request);
      if (err) return err;
      const date = body?.date || "";
      const id = body?.id || "";
      if (!DATE_RE.test(date)) return json(400, { error: "date required" });
      if (!ID_RE.test(id)) return json(400, { error: "bad id" });
      const key = `ticks:${date}`;
      let cur = {};
      try {
        cur = JSON.parse((await env.STORE.get(key)) || "{}");
      } catch {
        cur = {};
      }
      const items = cur.items && typeof cur.items === "object" ? cur.items : {};
      if (body.done) {
        items[id] = {
          done: true,
          kind: clip(body.kind || "task", 32),
          section: clip(body.section, 120),
          label: clip(body.label, 200),
          target: clip(body.target, 120),
          at: clip(body.at, 40) || new Date().toISOString(),
          via: clip(body.via, 16) || "phone",
        };
      } else {
        delete items[id];
      }
      const out = { date, items, updated: new Date().toISOString() };
      await env.STORE.put(key, JSON.stringify(out));
      return json(200, { ok: true, done: Object.keys(items).length });
    }

    // ---------- capture (unchanged) ----------
    if (path === "/capture" && method === "GET") {
      if (!qdate) return json(400, { error: "date required" });
      const raw = await env.STORE.get(`capture:${qdate}`);
      return raw200(raw || JSON.stringify({ date: qdate, items: [] }));
    }

    if (path === "/capture" && method === "POST") {
      const { body, err } = await readBody(request);
      if (err) return err;
      const date = body?.date || "";
      const text = String(body?.text ?? "").trim();
      if (!DATE_RE.test(date)) return json(400, { error: "date required" });
      if (!text) return json(400, { error: "text required" });
      const key = `capture:${date}`;
      let cur = {};
      try {
        cur = JSON.parse((await env.STORE.get(key)) || "{}");
      } catch {
        cur = {};
      }
      const items = Array.isArray(cur.items) ? cur.items : [];
      if (items.length >= 200) return json(429, { error: "capture full for the day" });
      // A retry after a dropped answer must not file the thought twice. The
      // phone stamps `at` once per capture, so at+text is the identity.
      const last = items[items.length - 1];
      if (last && last.at === clip(body.at, 40) && last.text === clip(text, 2000))
        return json(200, { ok: true, count: items.length, duplicate: true });
      items.push({
        text: clip(text, 2000),
        at: clip(body.at, 40) || new Date().toISOString(),
        via: "phone",
      });
      await env.STORE.put(key, JSON.stringify({ date, items, updated: new Date().toISOString() }));
      return json(200, { ok: true, count: items.length });
    }

    // ---------- desk: the idea inbox ----------
    // One KV key per note (desk:<id>): no growing value, no O(n^2) append, no
    // 25MB ceiling, no lost update. POST /desk must be incapable of any 4xx
    // except 401, because sync.js drops the queue head on ANY 4xx, so a
    // validation 400 would lose the note as silently as a 429.
    if (path === "/desk" && method === "POST") {
      let text = "";
      let at = "";
      try {
        const raw = await request.text();
        try {
          const body = JSON.parse(raw);
          text = String(body?.text ?? "").trim();
          at = clip(body?.at, 40);
        } catch {
          text = String(raw || "").trim(); // not JSON: the words still count
        }
      } catch {}
      if (!text) return json(200, { ok: true, empty: true }); // never 4xx
      const d = new Date();
      const rand = [...crypto.getRandomValues(new Uint8Array(4))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const id = `d-${d.toISOString().slice(0, 10).replace(/-/g, "")}-${rand}`;
      const note = { id, text: clip(text, 8000), at: at || d.toISOString(), via: who };
      // 30-day backstop TTL: the drain normally consumes within the hour, but
      // if it dies (the standing wire-automation failure class) raw notes must
      // not accumulate in KV forever behind one key (Lawyer). The doctor
      // complains long before this fires.
      await env.STORE.put(`desk:${id}`, JSON.stringify(note), { expirationTtl: DESK_TTL });
      return json(200, { ok: true, id });
    }

    if (path === "/desk" && method === "GET") {
      // both roles; the board is the derived view, the raw notes are for the
      // laptop drain only
      const board = await env.STORE.get("deskboard:latest");
      if (who === "phone") return raw200(board || JSON.stringify({ built: null, tickets: [] }));
      const list = await env.STORE.list({ prefix: "desk:", limit: 200 });
      const notes = [];
      for (const k of list.keys) {
        const raw = await env.STORE.get(k.name);
        if (!raw) continue;
        try {
          notes.push(JSON.parse(raw));
        } catch {}
      }
      let parsedBoard = null;
      try {
        parsedBoard = board ? JSON.parse(board) : null;
      } catch {}
      return json(200, { board: parsedBoard, notes });
    }

    if (path === "/desk" && method === "DELETE") {
      // laptop only via the role gate; the drain consumes a note after filing
      const id = url.searchParams.get("id") || "";
      if (!ID_RE.test(id)) return json(400, { error: "bad id" });
      await env.STORE.delete(`desk:${id}`);
      return json(200, { ok: true, id });
    }

    // Approve rides its own route so the path gate applies. The secret is a
    // 128-bit-minimum value from the password manager, never persisted
    // client-side; it defends the key at rest, not script running in the page.
    if (path === "/deskapprove" && method === "POST") {
      const { body, err } = await readBody(request);
      if (err) return err;
      const id = String(body?.id || "");
      if (!ID_RE.test(id)) return json(400, { error: "bad id" });
      const secret = String(body?.secret || "");
      const wanted = keySet(env, "DESK_APPROVE_KEY", "DESK_APPROVE_KEYS");
      let okSecret = false;
      for (const w of wanted) if (sameKey(secret, w)) okSecret = true;
      if (!wanted.length || !okSecret) return json(403, { error: "bad approve secret" });
      const rec = { id, approve: body?.approve !== false, at: new Date().toISOString(), via: who };
      // TTL so approval records (an id list, no secret) do not grow forever;
      // nothing in lane 8a consumes them (Lawyer).
      await env.STORE.put(`deskapprove:${id}`, JSON.stringify(rec), { expirationTtl: DESK_TTL });
      return json(200, { ok: true, id, approve: rec.approve });
    }

    if (path === "/deskapprove" && method === "GET") {
      // the drain polls approvals; records hold no secret
      const list = await env.STORE.list({ prefix: "deskapprove:", limit: 200 });
      const items = [];
      for (const k of list.keys) {
        const raw = await env.STORE.get(k.name);
        if (!raw) continue;
        try {
          items.push(JSON.parse(raw));
        } catch {}
      }
      return json(200, { items });
    }

    if (path === "/deskboard" && method === "POST") {
      // laptop only via the role gate: the drain derives, the phone renders
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      if (!body || typeof body !== "object" || !Array.isArray(body.tickets))
        return json(400, { error: "board must be {built, tickets[]}" });
      await env.STORE.put("deskboard:latest", raw);
      return json(200, { ok: true, tickets: body.tickets.length });
    }

    // ---------- news ----------
    if (path === "/news" && method === "GET") {
      const raw = await getDated(env, "news", qdate);
      if (!raw) return json(404, { error: "no edition yet" });
      return raw200(raw);
    }

    if (path === "/news" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateNews(body);
      if (bad) return json(400, { error: bad });
      await putDated(env, "news", body.date, raw);
      return json(200, { ok: true, date: body.date, stories: body.stories.length, bytes: raw.length });
    }

    // ---------- newsread ----------
    if (path === "/newsread" && method === "GET") {
      if (!qdate) return json(400, { error: "date required" });
      const raw = await env.STORE.get(`newsread:${qdate}`);
      return raw200(raw || JSON.stringify({ date: qdate, ids: [] }));
    }

    if (path === "/newsread" && method === "POST") {
      const { body, err } = await readBody(request);
      if (err) return err;
      const date = body?.date || "";
      if (!DATE_RE.test(date)) return json(400, { error: "date required" });
      if (!Array.isArray(body.ids) || !body.ids.every((i) => typeof i === "string"))
        return json(400, { error: "ids must be an array of story-id strings" });
      const key = `newsread:${date}`;
      let cur = {};
      try {
        cur = JSON.parse((await env.STORE.get(key)) || "{}");
      } catch {
        cur = {};
      }
      const set = new Set(Array.isArray(cur.ids) ? cur.ids : []);
      for (const id of body.ids) if (id.length <= 64) set.add(id);
      if (set.size > 500) return json(429, { error: "read set full for the day" });
      const out = { date, ids: [...set], updated: new Date().toISOString() };
      await env.STORE.put(key, JSON.stringify(out));
      return json(200, { ok: true, count: set.size });
    }

    // ---------- markets ----------
    if (path === "/markets" && method === "GET") {
      const raw = await getDated(env, "markets", qdate);
      if (!raw) return json(404, { error: "no digest yet" });
      return raw200(raw);
    }

    if (path === "/markets" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateMarkets(body);
      if (bad) return json(400, { error: bad });
      await putDated(env, "markets", body.date, raw);
      return json(200, { ok: true, date: body.date, sections: body.sections.length });
    }

    // ---------- holdings ----------
    if (path === "/holdings" && method === "GET") {
      const raw = await env.STORE.get("holdings:latest");
      if (!raw) return json(404, { error: "no holdings yet" });
      return raw200(raw);
    }

    if (path === "/holdings" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateHoldings(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("holdings:latest", raw);
      return json(200, { ok: true, asOf: body.asOf, positions: body.positions.length });
    }

    // ---------- library ----------
    // The vault index: the write-ups themselves, so the phone can read them
    // offline instead of bouncing to Obsidian. Same latest-wins shape as
    // holdings; the laptop pushes, the phone reads.
    if (path === "/library" && method === "GET") {
      const raw = await env.STORE.get("library:latest");
      if (!raw) return json(404, { error: "no library yet" });
      return raw200(raw);
    }

    if (path === "/library" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateLibrary(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("library:latest", raw);
      return json(200, { ok: true, notes: body.notes.length });
    }

    // ---------- moves ----------
    // Why each ticker moved today, lifted from the market-close digest. The
    // Money tab shows it next to the red number instead of leaving David to
    // guess at a reason.
    if (path === "/moves" && method === "GET") {
      const raw = await env.STORE.get("moves:latest");
      if (!raw) return json(404, { error: "no moves yet" });
      return raw200(raw);
    }

    if (path === "/moves" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateMoves(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("moves:latest", raw);
      return json(200, { ok: true, date: body.date, tickers: Object.keys(body.moves).length });
    }

    // ---------- listen ----------
    if (path === "/listen" && method === "GET") {
      const raw = await env.STORE.get("listen:latest");
      if (!raw) return json(404, { error: "no queue yet" });
      return raw200(raw);
    }

    if (path === "/listen" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateListen(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("listen:latest", raw);
      return json(200, { ok: true, queue: body.queue.length });
    }

    // ---------- career ----------
    if (path === "/career" && method === "GET") {
      const raw = await env.STORE.get("career:latest");
      if (!raw) return json(404, { error: "no roster yet" });
      return raw200(raw);
    }

    if (path === "/career" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateCareer(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("career:latest", raw);
      return json(200, { ok: true, roster: body.roster.length });
    }

    if (path === "/shopping" && method === "GET") {
      const raw = await env.STORE.get("shopping:latest");
      if (!raw) return json(404, { error: "no shopping list yet" });
      return raw200(raw);
    }

    if (path === "/shopping" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateShopping(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put("shopping:latest", raw);
      const n = body.sections.reduce((a, s) => a + s.items.length, 0);
      return json(200, { ok: true, sections: body.sections.length, items: n });
    }

    // ---------- reps: permanent archive of graded interview answers ----------
    // The per-date feedback keys expire in 14 days (they feed the transient
    // under-question cards); this is the Career tab's forever list, maintained
    // and pushed whole by transcribe_grade.py after each grading run.
    if (path === "/reps" && method === "GET") {
      const raw = await env.STORE.get("reps:latest");
      return raw200(raw || JSON.stringify({ items: [] }));
    }

    if (path === "/reps" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      if (!body || !Array.isArray(body.items) || body.items.length > 300)
        return json(400, { error: "reps payload needs items[] (max 300)" });
      await env.STORE.put("reps:latest", raw);
      return json(200, { ok: true, items: body.items.length });
    }

    // ---------- bolt: clothing-watcher status, pushed by the bolt repo's Action ----------
    if (path === "/bolt" && method === "GET") {
      const raw = await env.STORE.get("bolt:latest");
      if (!raw) return json(404, { error: "no bolt status yet" });
      return raw200(raw);
    }

    if (path === "/bolt" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      if (!body || typeof body !== "object" || typeof body.built !== "string")
        return json(400, { error: "bolt payload needs built (ISO string)" });
      await env.STORE.put("bolt:latest", raw);
      return json(200, { ok: true, tracked: body.tracked ?? 0 });
    }

    // ---------- scan: yesterday's handwritten list, raw JPEG ----------
    if (path === "/scan" && method === "GET") {
      if (!qdate) return json(400, { error: "date required" });
      const buf = await env.STORE.get(`scan:${qdate}`, "arrayBuffer");
      if (!buf) return json(404, { error: "no scan for that date" });
      return bytes200(buf, "image/jpeg");
    }

    if (path === "/scan" && method === "POST") {
      if (!qdate) return json(400, { error: "date required" });
      const { buf, err } = await readBlob(request, capFor(path), ["image/jpeg"]);
      if (err) return err;
      const at = new Date().toISOString();
      await env.STORE.put(`scan:${qdate}`, buf, { expirationTtl: BLOB_TTL });
      await env.STORE.put(
        `scanmeta:${qdate}`,
        JSON.stringify({ date: qdate, bytes: buf.byteLength, at }),
        { expirationTtl: BLOB_TTL },
      );
      return json(200, { ok: true, date: qdate, bytes: buf.byteLength });
    }

    // ---------- answer: one spoken interview rep, raw audio ----------
    if (path === "/answer") {
      const qid = url.searchParams.get("qid") || "";
      if (!qdate) return json(400, { error: "date required" });
      if (qid && !ID_RE.test(qid)) return json(400, { error: "bad qid" });

      if (method === "POST") {
        if (!qid) return json(400, { error: "qid required" });
        const { buf, ct, err } = await readBlob(request, capFor(path), AUDIO_TYPES);
        if (err) return err;
        const at = new Date().toISOString();
        const meta = { date: qdate, qid, bytes: buf.byteLength, type: ct, at };
        await env.STORE.put(`answer:${qdate}:${qid}`, buf, { expirationTtl: BLOB_TTL });
        await env.STORE.put(`answermeta:${qdate}:${qid}`, JSON.stringify(meta), {
          expirationTtl: BLOB_TTL,
        });
        const items = (await answerIndex(env, qdate)).filter((i) => i && i.qid !== qid);
        items.push({ qid, bytes: buf.byteLength, type: ct, at });
        await putAnswerIndex(env, qdate, items.slice(-40));
        return json(200, { ok: true, date: qdate, qid, bytes: buf.byteLength });
      }

      // laptop only past here: the phone allowlist blocks GET and DELETE
      if (method === "GET" && !qid) return json(200, { items: await answerIndex(env, qdate) });

      if (method === "GET") {
        const buf = await env.STORE.get(`answer:${qdate}:${qid}`, "arrayBuffer");
        if (!buf) return json(404, { error: "no answer for that date and qid" });
        let type = "audio/mp4";
        try {
          type = JSON.parse((await env.STORE.get(`answermeta:${qdate}:${qid}`)) || "{}").type || type;
        } catch {}
        return bytes200(buf, type);
      }

      if (method === "DELETE") {
        if (!qid) return json(400, { error: "qid required" });
        await env.STORE.delete(`answer:${qdate}:${qid}`);
        await env.STORE.delete(`answermeta:${qdate}:${qid}`);
        const items = (await answerIndex(env, qdate)).filter((i) => i && i.qid !== qid);
        await putAnswerIndex(env, qdate, items);
        return json(200, { ok: true, date: qdate, qid, remaining: items.length });
      }
    }

    // ---------- feedback: the graded answers coming back ----------
    if (path === "/feedback" && method === "GET") {
      if (!qdate) return json(400, { error: "date required" });
      const raw = await env.STORE.get(`feedback:${qdate}`);
      return raw200(raw || JSON.stringify({ date: qdate, items: [] }));
    }

    if (path === "/feedback" && method === "POST") {
      const { raw, body, err } = await readBody(request);
      if (err) return err;
      const bad = validateFeedback(body);
      if (bad) return json(400, { error: bad });
      await env.STORE.put(`feedback:${body.date}`, raw, { expirationTtl: BLOB_TTL });
      return json(200, { ok: true, date: body.date, items: body.items.length });
    }

    // ---------- quotes ----------
    if (path === "/quotes" && method === "GET") {
      const syms = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!syms.length) return json(400, { error: "symbols required, e.g. ?symbols=VTI,TOST" });
      if (syms.length > 20) return json(400, { error: "max 20 symbols" });
      for (const s of syms) if (!TICKER_RE.test(s)) return json(400, { error: `bad symbol ${s}` });
      const results = await Promise.all(
        syms.map((s) => cachedFetch(env, `quote:${s}`, QUOTE_TTL, () => fetchQuote(s))),
      );
      const quotes = {};
      syms.forEach((s, i) => (quotes[s] = results[i]));
      return json(200, { quotes, at: new Date().toISOString() });
    }

    // ---------- quotehistory ----------
    if (path === "/quotehistory" && method === "GET") {
      const sym = (url.searchParams.get("symbol") || "").trim().toUpperCase();
      const range = url.searchParams.get("range") || "1m";
      if (!TICKER_RE.test(sym)) return json(400, { error: "bad symbol" });
      if (!["1d", "1w", "1m", "max"].includes(range))
        return json(400, { error: "range must be 1d|1w|1m|max" });
      const ttl = range === "1d" ? INTRADAY_TTL : HIST_TTL;
      const out = await cachedFetch(env, `qh:${sym}:${range}`, ttl, () => fetchHistory(sym, range));
      return json(200, out);
    }

    return json(404, { error: "not found" });
  },
};
