// node tools/test_news_body.mjs: a story body renders as paragraphs, never one letter per line
// (11/27: every story in the paper showed "T", "h", "e" stacked on David's phone).
import { bodyParas } from "../prose.js";

let fails = 0, n = 0;
function eq(a, b, msg) {
  n++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.log("FAIL", msg, "\n  got ", JSON.stringify(a), "\n  want", JSON.stringify(b)); }
}

eq(bodyParas(["First paragraph.", "Second paragraph."]), ["First paragraph.", "Second paragraph."], "a list stays a list");
eq(bodyParas("The Trump administration announced a rule.\n\nNvidia told partners."),
  ["The Trump administration announced a rule.", "Nvidia told partners."], "a string splits on blank lines");
eq(bodyParas("One line.\nAnother line."), ["One line.", "Another line."], "a string with single breaks splits on them");
eq(bodyParas("Just one paragraph."), ["Just one paragraph."], "a plain string is one paragraph");
eq(bodyParas(["T", "h", "e", "T", "r", "u", "m", "p"]), [], "a list of letters is no body");
eq(bodyParas([" ", "", "Real paragraph."]), ["Real paragraph."], "blanks drop");
eq(bodyParas(null), [], "missing body");
eq(bodyParas({ a: 1 }), [], "an object is no body");
eq(bodyParas([3, "Real paragraph."]), ["Real paragraph."], "non-strings drop");

console.log(fails ? `${fails} of ${n} FAILED` : `ok ${n} checks`);
process.exit(fails ? 1 : 0);
