// prose.js: a story body as paragraphs, whatever shape it arrived in (lighthouse, 2026-11-27).
//
// On 11/27 the compiler wrote every body as one string and then split it into
// single letters, so David's phone showed "T", "h", "e" one per line. The
// compiler is fixed; this is the reader's half: a string splits on blank
// lines, a list of single letters counts as no body (the story then falls back
// to its facts), and anything else is dropped. Pure, so node can test it.

export function bodyParas(b) {
  if (typeof b === "string") {
    let parts = b.trim().split(/\n\s*\n/);
    if (parts.length === 1) parts = b.trim().split("\n");
    b = parts;
  }
  if (!Array.isArray(b)) return [];
  const out = b.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  const letters = out.reduce((n, p) => n + p.length, 0);
  return out.length && letters <= 2 * out.length ? [] : out;
}
