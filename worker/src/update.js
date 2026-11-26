// The Daily Update (lighthouse, 2026-11-25). One page each morning: what moved,
// answers to his questions, ideas with yes / no, what he needs to decide.
// crystal-assistant/daily_update.py builds it; the Update tab renders it.
//
//   POST /update        laptop pushes the edition {v:1, date, ...}  -> update:<date>, update:latest
//   GET  /update        latest edition. A PHONE read stamps update:seen, which is the
//                       experiment David named: "we can see if I actually read that".
//   GET  /update?date=  one day's edition (no stamp: browsing history is not a read)
//   GET  /update/seen   {seen:[iso,...]} last 120 phone opens            (laptop)
//
// Plans, look backs and idea votes do NOT come through here: the page posts
// them to /desk as "plan: ...", "did: ...", "idea yes <id>", so they ride the
// existing offline-safe Desk queue and daily_update.py pull() files them.
//
// Wired from index.js after the auth gate; helpers come from there so CORS and
// body caps stay in one place.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAP = 96 * 1024;
const TTL = 60 * 60 * 24 * 60; // 60 days of history

export async function handleUpdate(request, env, who, path, method, url, h) {
  const { json, raw200, readBody } = h;

  if (path === "/update/seen" && method === "GET") {
    if (who !== "laptop") return json(403, { error: "laptop key required for this route" });
    let seen = [];
    try { seen = JSON.parse((await env.STORE.get("update:seen")) || "[]"); } catch {}
    return json(200, { seen });
  }

  if (path !== "/update") return null;
  const qdate = url.searchParams.get("date") || "";

  if (method === "GET") {
    const raw = await env.STORE.get(qdate ? `update:${qdate}` : "update:latest");
    if (who === "phone" && !qdate) {
      try {
        let seen = JSON.parse((await env.STORE.get("update:seen")) || "[]");
        if (!Array.isArray(seen)) seen = [];
        seen.push(new Date().toISOString());
        await env.STORE.put("update:seen", JSON.stringify(seen.slice(-120)));
      } catch {}
    }
    if (!raw) return json(404, { error: "no update yet" });
    return raw200(raw);
  }

  if (method === "POST") {
    if (who !== "laptop") return json(403, { error: "laptop key required for this route" });
    const { raw, body, err } = await readBody(request, CAP);
    if (err) return err;
    if (body?.v !== 1 || !DATE_RE.test(body?.date || "")) return json(400, { error: "update v1 with date required" });
    for (const k of ["moved", "answers", "ideas", "decide"])
      if (body[k] !== undefined && !Array.isArray(body[k])) return json(400, { error: `${k} must be a list` });
    await env.STORE.put(`update:${body.date}`, raw, { expirationTtl: TTL });
    let cur = null;
    try { cur = JSON.parse((await env.STORE.get("update:latest")) || "null"); } catch {}
    if (!cur || !cur.date || cur.date <= body.date) await env.STORE.put("update:latest", raw);
    return json(200, { ok: true, date: body.date, bytes: raw.length });
  }

  return json(405, { error: "method not allowed" });
}
