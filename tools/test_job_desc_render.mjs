// Tests for richOrPlain() in jobs.js — the job-description render path.
// Descriptions are stored as SERVER-sanitized rich HTML, so they must render
// as HTML (previously they were escaped, which showed saved formatting as
// literal tag soup). Legacy rows predating rich text are plain text with
// newlines and must still be escaped.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const eq = (g, w, n) => { g === w ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log(`  ✗ ${n}\n      want: ${w}\n      got:  ${g}`)); };

const src = readFileSync("assets/js/jobs.js", "utf8");
const dom = new JSDOM(`<!doctype html><body></body>`);
global.window = dom.window; global.document = dom.window.document;
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  const open = src.indexOf("{", src.indexOf(")", start));
  let j = open, d = 0;
  do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0);
  return src.slice(start, j);
}
const richOrPlain = new Function("esc", extractFn(src, "richOrPlain") + "; return richOrPlain;")(esc);

console.log("sanitized rich HTML renders as HTML");
eq(richOrPlain("<ul><li>one</li></ul>"), "<ul><li>one</li></ul>", "list passes through as markup");
eq(richOrPlain("<strong>bold</strong>"), "<strong>bold</strong>", "bold passes through");
eq(richOrPlain('<a href="https://e.com" rel="nofollow noopener noreferrer" target="_blank">x</a>'),
   '<a href="https://e.com" rel="nofollow noopener noreferrer" target="_blank">x</a>', "sanitized link passes through");
// teeth: it must NOT be double-escaped (the bug being fixed)
ok(!richOrPlain("<strong>bold</strong>").includes("&lt;strong&gt;"), "markup is not escaped into tag soup");

console.log("\nlegacy plain-text descriptions");
eq(richOrPlain("line one\nline two"), "line one<br>line two", "newlines become breaks");
eq(richOrPlain("plain text"), "plain text", "plain text unchanged");
eq(richOrPlain(""), "", "empty stays empty");
eq(richOrPlain(null), "", "null is handled");

console.log("\nplain text containing angle brackets is escaped");
const out = richOrPlain("5 < 10 and 20 > 3");
ok(out.includes("&lt;") && out.includes("&gt;"), "bare angle brackets escaped in plain text");
ok(!out.includes("<script"), "no raw tag injection from plain text");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
