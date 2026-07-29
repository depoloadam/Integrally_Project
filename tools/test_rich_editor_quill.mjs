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

const dom = new JSDOM(`<!doctype html><body><div id="host"></div><div id="host2"></div></body>`,
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
w.eval(editorSrc + "\n;window.mountRichEditor = mountRichEditor; window.__RT_FORMATS = RT_FORMATS;");
ok(typeof w.mountRichEditor === "function", "mountRichEditor loads");
const RT_FORMATS_CHECK = w.__RT_FORMATS || [];

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
// Headings are gone from the TOOLBAR but stay whitelisted server-side, so
// pasted or legacy <h2>/<h3> still render. Assert that directly.
const heads = execFileSync("php", ["-r",
  'require "src/RichText.php"; echo RichText::clean("<h2>H</h2><h3>S</h3>");'
], { encoding: "utf8" });
ok(heads.includes("<h2>") && heads.includes("<h3>"), "legacy/pasted headings still survive sanitizer");

console.log("\ntoolbar composition (no duplicate/ambiguous controls)");
const tb = w.document.querySelector(".ql-toolbar");
ok(!!tb, "toolbar rendered");
// Quill maps `code` and `code-block` to the SAME icon, so having both made
// two identical </> buttons. Only the block version is on the toolbar.
ok(!!tb.querySelector("button.ql-code-block"), "code-block button present");
ok(!tb.querySelector("button.ql-code"), "inline-code button removed (was an identical icon)");
// ...but the format is still accepted, so pasted inline code survives.
ok(RT_FORMATS_CHECK.includes("code"), "inline code still an allowed format");
// Heading/paragraph picker removed from the toolbar — size controls text
// scale instead. The format stays whitelisted so pasted headings survive.
ok(!tb.querySelector(".ql-picker.ql-header"), "heading picker removed from toolbar");
ok(!!tb.querySelector(".ql-picker.ql-size"), "size picker present");
const css = readFileSync("assets/css/app.css", "utf8");
[["12px","Small"],["24px","Large"],["32px","Huge"]].forEach(([v,l]) =>
  ok(css.includes(`ql-size .ql-picker-item[data-value="${v}"]::before { content:"${l}"; }`)
     || new RegExp(`data-value="${v}"\\]::before \\{ content:"${l}"`).test(css),
     `size ${v} labelled '${l}'`));

console.log("\ncode block: visible text + an escape route");
// Quill snow ships a dark code block (#23241f bg, #f8f8f2 text). We re-skin
// it light, so the colour MUST be overridden or the code is invisible.
const cssB = readFileSync("assets/css/app.css", "utf8");
const cbRule = cssB.slice(cssB.indexOf(".rt-editor .ql-snow .ql-editor .ql-code-block-container"),
                          cssB.indexOf(".rt-editor .ql-snow .ql-editor .ql-code-block-container") + 500);
ok(/color:var\(--in-ink\)/.test(cbRule), "code block sets an explicit text colour (not Quill's near-white)");
ok(!/#f8f8f2/.test(cbRule), "Quill's light-on-light text colour is not carried over");

// A trailing code block must not trap the caret: a plain paragraph follows it.
const tEd = w.mountRichEditor("host2", {});
tEd.quill.setContents([{ insert: "code();" }, { insert: "\n", attributes: { "code-block": true } }]);
const tLen = tEd.quill.getLength();
const [tLast] = tEd.quill.getLine(tLen - 1);
const tF = tLast && tLast.formats ? tLast.formats() : {};
ok(!tF["code-block"], "a plain paragraph is appended after a trailing code block");
ok(/<pre>code\(\);<\/pre>/.test(tEd.getHTML()), "the code block itself still exports correctly");
// ...and the helper paragraph is empty, so the sanitizer drops it on save.
const savedTail = execFileSync("php", ["-r",
  'require "src/RichText.php"; echo RichText::clean("<pre>code();</pre><p></p>");'], { encoding: "utf8" });
ok(savedTail === "<pre>code();</pre>", "the helper paragraph is stripped on save (not stored)");

console.log("\ntoolbar alignment (uniform control height, no floats)");
// Strip CSS comments first — prose describing Quill's own 22px line-height
// would otherwise be matched as if it were a declaration.
const cssT = readFileSync("assets/css/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// A selector may be styled in more than one block (theming, then layout);
// collect every occurrence so we assert against the full cascade.
const rule = (sel) => {
  let out = "", i = -1;
  while ((i = cssT.indexOf(sel + " {", i + 1)) >= 0) out += cssT.slice(i, cssT.indexOf("}", i)) + "\n";
  return out;
};
const tbRule = rule(".rt-editor .ql-toolbar.ql-snow");
ok(/display:flex/.test(tbRule), "toolbar uses flex layout");
ok(/align-items:center/.test(tbRule), "controls are vertically centred");
const btnRule = rule(".rt-editor .ql-snow.ql-toolbar button");
const pickRule = rule(".rt-editor .ql-snow .ql-picker");
ok(/float:none/.test(btnRule), "button floats are cleared");
ok(/float:none/.test(pickRule), "picker floats are cleared");
// last declaration wins in the cascade
const h = (r) => { const m = [...r.matchAll(/height:(\d+)px/g)]; return m.length ? m[m.length - 1][1] : undefined; };
ok(h(btnRule) && h(btnRule) === h(pickRule),
   `buttons and pickers share a height (${h(btnRule)}px vs ${h(pickRule)}px)`);
// The align + colour controls are PICKERS, so button-svg sizing never reached
// them — that is why those two icons rendered larger and lower than the rest.
ok(/width:17px/.test(cssT.slice(cssT.indexOf(".ql-icon-picker .ql-picker-label svg"))),
   "icon/colour picker SVGs are explicitly sized");
ok(cssT.includes(".rt-editor .ql-snow .ql-icon-picker .ql-picker-label svg"),
   "align (icon picker) SVG is targeted");

// ---- Stage 3: markdown shortcuts + paste cleaning ---------------------
// Drives a keystroke the way Quill's keyboard module does: at the caret, find
// the binding for `key` whose prefix matches the line text before the caret,
// and call its handler. Returns what the handler returned (false = swallowed).
function typeShortcut(ed, key) {
  const q = ed.quill;
  const sel = q.getSelection(true) || { index: q.getLength() - 1, length: 0 };
  const [line, offsetInLine] = q.getLine(sel.index);
  const lineStart = sel.index - offsetInLine;
  const before = q.getText(lineStart, sel.index - lineStart);
  const fmt = q.getFormat(sel.index);
  const bindings = q.getModule("keyboard").bindings[key] || [];
  for (const b of bindings) {
    if (!b.prefix || !b.prefix.test(before)) continue;
    // Honour Quill's own format guard: a binding with format:{"code-block":false}
    // must NOT fire when the line already has that format.
    if (b.format && typeof b.format === "object" && !Array.isArray(b.format)) {
      const blocked = Object.keys(b.format).some(k =>
        b.format[k] === false ? fmt[k] != null : b.format[k] === true ? fmt[k] == null : false);
      if (blocked) continue;
    }
    const ctx = { prefix: before, collapsed: true, line, offset: offsetInLine, format: fmt };
    return b.handler.call({ quill: q }, { index: sel.index, length: 0 }, ctx);
  }
  return true;   // no shortcut matched — the key would type normally
}

console.log("\nStage 3: markdown input shortcuts (block-level only)");
const mdCase = (setup, key, wantHTML, label) => {
  ed.clear();
  setup(ed.quill);
  const swallowed = typeShortcut(ed, key) === false;
  ok(swallowed, `${label}: trigger key is swallowed`);
  ok(wantHTML.test(ed.getHTML()), `${label}: line becomes ${wantHTML}`);
};
mdCase(q => { q.insertText(0, "-", "user"); q.setSelection(1, 0); },
  " ", /<ul>/, "'- ' → bullet list");
mdCase(q => { q.insertText(0, "*", "user"); q.setSelection(1, 0); },
  " ", /<ul>/, "'* ' → bullet list");
mdCase(q => { q.insertText(0, "1.", "user"); q.setSelection(2, 0); },
  " ", /<ol>/, "'1. ' → numbered list");
mdCase(q => { q.insertText(0, ">", "user"); q.setSelection(1, 0); },
  " ", /<blockquote>/, "'> ' → blockquote");
mdCase(q => { q.insertText(0, "``", "user"); q.setSelection(2, 0); },
  "`", /<pre>/, "'```' → code block");

// The token itself must be gone, not left as literal text in the line.
ed.clear();
ed.quill.insertText(0, "-", "user"); ed.quill.setSelection(1, 0);
typeShortcut(ed, " ");
ed.quill.insertText(ed.quill.getSelection(true).index, "item", "user");
ok(/<ul><li>item<\/li><\/ul>/.test(ed.getHTML()), "trigger token is consumed, not left as text");

// No `## ` heading shortcut — heading authoring was removed, and the markdown
// path must not reintroduce it. Typing '## ' should produce literal text.
ed.clear();
ed.quill.insertText(0, "##", "user"); ed.quill.setSelection(2, 0);
ok(typeShortcut(ed, " ") !== false, "'## ' is NOT a shortcut (returns normally)");
ok(!/<h2>|<h3>/.test(ed.getHTML()), "'## ' does not create a heading");

// Shortcuts are inert inside a code block — dashes/backticks stay literal.
ed.clear();
ed.quill.setContents([{ insert: "-" }, { insert: "\n", attributes: { "code-block": true } }]);
ed.quill.setSelection(1, 0);
ok(typeShortcut(ed, " ") !== false, "inside a code block, '- ' does not fire");

console.log("\nStage 3: paste cleaning (keeps whitelisted formats, strips noise)");
// clipboard.convert runs the registered matchers. Feed it messy HTML and
// inspect the resulting Delta / round-tripped HTML.
const pasteHTML = (html) => {
  ed.clear();
  const delta = ed.quill.clipboard.convert({ html });
  ed.quill.setContents(delta);
  return ed.getHTML();
};
// A pasted bulleted list stays a list (whitelisted format is kept).
ok(/<ul>/.test(pasteHTML("<ul><li>a</li><li>b</li></ul>")), "pasted bullet list survives");
// Background colour, font-family, line-height are stripped.
const noisy = pasteHTML('<p style="background-color:#ff0;font-family:Arial;line-height:2">x</p>');
ok(!/background-color/i.test(noisy), "pasted background-color is stripped");
ok(!/font-family/i.test(noisy), "pasted font-family is stripped");
ok(!/line-height/i.test(noisy), "pasted line-height is stripped");
// A font-size NOT in the enum is dropped; one that IS survives.
ok(!/font-size:\s*37px/.test(pasteHTML('<p style="font-size:37px">x</p>')), "off-enum font-size is stripped");
ok(/font-size:\s*24px/.test(pasteHTML('<span style="font-size:24px">x</span>')), "in-enum font-size (24px) survives paste");
// And the whole thing still survives the real server sanitizer.
const pastedOut = pasteHTML('<ul><li>a</li></ul><p style="background-color:#ff0">b</p>');
const pastedClean = execFileSync("php", ["-r",
  'require "src/RichText.php"; echo RichText::clean(file_get_contents("php://stdin"));'
], { input: pastedOut, encoding: "utf8" });
ok(/<ul>/.test(pastedClean) && !/background-color/i.test(pastedClean),
   "cleaned paste survives src/RichText.php intact");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
