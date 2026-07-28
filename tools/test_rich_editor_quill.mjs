// Stage 2 tests: the Quill-backed mountRichEditor in shell.js.
// Loads the REAL vendored Quill build and the REAL wrapper, then checks
//   (a) the API contract consumers depend on,
//   (b) the Quill 2.0.3 code-block export bug is repaired,
//   (c) every format the editor can produce SURVIVES src/RichText.php.
// (c) is the point of the whole stage: if the editor emits something the
// sanitizer strips, users watch their formatting vanish on save.

import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };
const eq = (g, w, n) => { g === w ? (pass++, console.log("  ✓ " + n))
  : (fail++, console.log(`  ✗ ${n}\n      want: ${w}\n      got:  ${g}`)); };

const dom = new JSDOM(`<!doctype html><body><div id="host"></div></body>`,
  { pretendToBeVisual: true, runScripts: "outside-only" });
const w = dom.window;
// jsdom lacks Range.getBoundingClientRect / getClientRects, which Quill's
// focus -> scrollSelectionIntoView path calls. Shim them: this is a jsdom
// gap, not behaviour under test.
const zeroRect = () => ({ top:0, left:0, bottom:0, right:0, width:0, height:0, x:0, y:0 });
w.Range.prototype.getBoundingClientRect = zeroRect;
w.Range.prototype.getClientRects = () => [];
if (!w.Element.prototype.getBoundingClientRect) w.Element.prototype.getBoundingClientRect = zeroRect;
w.eval(readFileSync("assets/js/vendor/quill.js", "utf8"));
ok(typeof w.Quill === "function", "vendored Quill build loads");

// Provide the two shell.js helpers the editor uses, then evaluate the real
// editor code (constants + registration + mountRichEditor) in window scope.
w.$ = (id) => w.document.getElementById(id);
w.esc = (s) => (s ?? "").toString().replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const shell = readFileSync("assets/js/shell.js", "utf8");
const slice = (from, to) => shell.slice(shell.indexOf(from), shell.indexOf(to));
const editorSrc =
  shell.slice(shell.indexOf("const RT_COLORS"), shell.indexOf("\n}\n", shell.indexOf("function mountRichEditor")) + 3);
w.eval(editorSrc + "\n;window.mountRichEditor = mountRichEditor;");
ok(typeof w.mountRichEditor === "function", "mountRichEditor loads");

console.log("\nAPI contract (what feed.js / company.js depend on)");
const ed = w.mountRichEditor("host", { placeholder: "Write something…" });
ok(!!ed, "editor mounts");
["getHTML", "getText", "setHTML", "insertText", "clear", "focus", "el"].forEach(k =>
  ok(typeof ed[k] !== "undefined", `exposes ${k}`));
ok(ed.el && ed.el.getAttribute("contenteditable") === "true", "el is the contenteditable surface");
ok(!!w.document.querySelector(".ql-toolbar"), "a toolbar is rendered");

console.log("\nbasic editing");
ed.setHTML("<p>hello</p>");
ok(ed.getText() === "hello", "getText returns plain text");
ok(/hello/.test(ed.getHTML()), "getHTML contains the content");
ed.insertText("!");
ok(/!/.test(ed.getText()), "insertText reaches the document");
ed.clear();
eq(ed.getText(), "", "clear empties the editor");

console.log("\nsetHTML keeps Quill's model in sync (the draft-restore path)");
ed.setHTML("<ul><li>one</li><li>two</li></ul>");
ok(ed.getText().includes("one") && ed.getText().includes("two"), "restored list is in the model, not just the DOM");
ok(/<ul>/.test(ed.getHTML()), "restored list exports as a real list");

console.log("\nQuill 2.0.3 code-block export bug is repaired");
// Build a code block through the model, the way the toolbar would.
ed.clear();
ed.quill.setContents([
  { insert: "const x = 1;" }, { insert: "\n", attributes: { "code-block": true } },
  { insert: "return x;" },    { insert: "\n", attributes: { "code-block": true } },
]);
const rawExport = ed.quill.getSemanticHTML();
ok(!/const x = 1;/.test(rawExport), "confirmed: Quill's own export drops code-block text");
const fixed = ed.getHTML();
ok(/const x = 1;/.test(fixed) && /return x;/.test(fixed), "our getHTML repairs it");
ok(/<pre>/.test(fixed), "repaired block is a <pre>");

console.log("\nevery editor format survives src/RichText.php");
ed.clear();
ed.quill.setContents([
  { insert: "Heading" },  { insert: "\n", attributes: { header: 2 } },
  { insert: "Sub" },      { insert: "\n", attributes: { header: 3 } },
  { insert: "bold", attributes: { bold: true } },
  { insert: "italic", attributes: { italic: true } },
  { insert: "under", attributes: { underline: true } }, { insert: "\n" },
  { insert: "bullet" },   { insert: "\n", attributes: { list: "bullet" } },
  { insert: "numbered" }, { insert: "\n", attributes: { list: "ordered" } },
  { insert: "quoted" },   { insert: "\n", attributes: { blockquote: true } },
  { insert: "code();" },  { insert: "\n", attributes: { "code-block": true } },
  { insert: "centered" }, { insert: "\n", attributes: { align: "center" } },
  { insert: "a link", attributes: { link: "https://example.com" } }, { insert: "\n" },
  { insert: "red", attributes: { color: "#ff0000" } }, { insert: "\n" },
  { insert: "big", attributes: { size: "24px" } }, { insert: "\n" },
  { insert: "inline", attributes: { code: true } }, { insert: "\n" },
]);
const produced = ed.getHTML();
writeFileSync("/tmp/_editor_out.html", produced);
const cleaned = execFileSync("php", ["-r",
  'require "src/RichText.php"; echo RichText::clean(file_get_contents("/tmp/_editor_out.html"));'
], { encoding: "utf8" });

const survives = [
  ["<h2>", "heading 2"], ["<h3>", "heading 3"],
  ["<strong>", "bold"], ["<em>", "italic"], ["<u>", "underline"],
  ["<ul>", "bulleted list"], ["<ol>", "numbered list"],
  ["<blockquote>", "blockquote"], ["<pre>", "code block"],
  ["rt-align-center", "alignment"],
  ['href="https://example.com"', "link"],
  ["color:#ff0000", "colour"], ["font-size:24px", "size"],
  ["<code>", "inline code"],
];
survives.forEach(([needle, label]) => ok(cleaned.includes(needle), `survives sanitizer: ${label}`));
ok(cleaned.includes("code();"), "code-block TEXT survives end to end");
// teeth: the sanitizer is genuinely running, not passing everything through
const evil = execFileSync("php", ["-r",
  'require "src/RichText.php"; echo RichText::clean("<script>bad()</script><b>ok</b>");'
], { encoding: "utf8" });
ok(!evil.includes("script") && evil.includes("ok"), "sanitizer still strips (round-trip check is meaningful)");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
