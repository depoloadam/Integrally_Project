// Behavioral check for the "@" mention picker in shell.js.
// Extracts the real module and drives it against jsdom with a stubbed
// api(), on BOTH a plain <input> (comments) and a contenteditable area
// (the post composer), since those take different code paths for
// reading the caret and splicing a completion back in.
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const src = readFileSync("assets/js/shell.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const marker = "// mention typeahead — \"@\" picker for the composer and comment boxes";
const start = src.indexOf(marker);
if (start === -1) { console.error("FATAL: mention module not found in shell.js"); process.exit(1); }
const moduleSrc = src.slice(start);

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
  url: "http://localhost/app.html", pretendToBeVisual: true,
});
const { window } = dom;
const document = window.document;
global.window = window; global.document = document;

Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
  configurable: true, get() { return this.classList?.contains("in-mention-menu") ? 200 : 20; },
});
Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
  configurable: true, get() { return this.classList?.contains("in-mention-menu") ? 260 : 200; },
});
Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => 1200 });
Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, get: () => 800 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { top: 200, bottom: 220, left: 100, right: 300, width: 200, height: 20 };
};
// jsdom implements neither of these on Range, but the module uses them to
// anchor the menu under the caret. Stub with a plausible caret box.
window.Range.prototype.getClientRects = function () {
  return [{ top: 200, bottom: 220, left: 140, right: 148, width: 8, height: 20 }];
};
window.Range.prototype.getBoundingClientRect = function () {
  return { top: 200, bottom: 220, left: 140, right: 148, width: 8, height: 20 };
};

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PEOPLE = [
  { uuid: "u-bob", username: "bob", name: "Bob Marsh", avatar: null, verified: false },
  { uuid: "u-bobby", username: "bobby", name: "Bobby Chen", avatar: null, verified: false },
  { uuid: "u-bo", username: "bo", name: "Bo Diaz", avatar: null, verified: true },
];
let apiCalls = [];
let apiDelay = 0;
const api = async (path) => {
  apiCalls.push(path);
  const q = decodeURIComponent((/q=([^&]*)/.exec(path) || [])[1] || "");
  if (apiDelay) await new Promise(r => setTimeout(r, apiDelay));
  const results = q === "" ? [] : PEOPLE.filter(p => p.username.startsWith(q.toLowerCase()));
  return { ok: true, data: { success: true, data: { results } } };
};

const factory = new Function(
  "window", "document", "esc", "api", "Event", "setTimeout", "clearTimeout",
  moduleSrc + "\n; return { attachMentionPicker, hideMentionMenu, mentionMenuOpen, MENTION_TRIGGER };"
);
const mod = factory(window, document, esc, api, window.Event, setTimeout, clearTimeout);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const menu = () => document.querySelector(".in-mention-menu");
const menuVisible = () => !!menu() && menu().style.display === "block";
const rows = () => Array.from(document.querySelectorAll(".in-mention-item"));

function makeInput(value = "") {
  const i = document.createElement("input");
  i.type = "text";
  i.value = value;
  document.body.appendChild(i);
  mod.attachMentionPicker(i);
  return i;
}
const typeInto = (input, value, caret = null) => {
  input.value = value;
  const pos = caret === null ? value.length : caret;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const key = (el, k) => {
  const ev = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

const W = 260;   // comfortably past MENTION_DEBOUNCE

console.log("\nmention picker — trigger detection");
{
  apiCalls = [];
  const i = makeInput();
  typeInto(i, "hello world");
  await sleep(W);
  ok(apiCalls.length === 0, "plain text does not query");

  typeInto(i, "hello @");
  await sleep(W);
  ok(apiCalls.length === 0, "a bare @ does not query (would scan the user table)");
  ok(!menuVisible(), "a bare @ shows no menu");

  typeInto(i, "hello @bo");
  await sleep(W);
  ok(apiCalls.length === 1, "typing after @ queries once");
  ok(menuVisible(), "menu opens with results");
  ok(rows().length === 3, "all matching people are listed");
  mod.hideMentionMenu();
  i.remove();
}

{
  apiCalls = [];
  const i = makeInput();
  typeInto(i, "email me at bob@example.com");
  await sleep(W);
  ok(apiCalls.length === 0, "an email address does not trigger the picker");
  i.remove();
}

{
  apiCalls = [];
  const i = makeInput();
  typeInto(i, "a@b");
  await sleep(W);
  ok(apiCalls.length === 0, "mid-word @ does not trigger");
  i.remove();
}

{
  apiCalls = [];
  const i = makeInput();
  typeInto(i, "(@bo");
  await sleep(W);
  ok(apiCalls.length === 1, "@ after an opening bracket does trigger");
  mod.hideMentionMenu(); i.remove();
}

console.log("\nmention picker — debounce and staleness");
{
  apiCalls = [];
  const i = makeInput();
  typeInto(i, "@b");
  typeInto(i, "@bo");
  typeInto(i, "@bob");
  await sleep(W);
  ok(apiCalls.length === 1, "rapid typing debounces to a single request");
  ok(/q=bob/.test(apiCalls[0]), "the request carries the final query");
  mod.hideMentionMenu(); i.remove();
}

{
  // A slow response for an abandoned query must not paint over a newer one.
  apiCalls = [];
  const i = makeInput();
  apiDelay = 120;
  typeInto(i, "@bo");
  await sleep(W);
  apiDelay = 0;
  mod.hideMentionMenu();
  await sleep(200);
  ok(!menuVisible(), "a stale in-flight response does not reopen a closed menu");
  i.remove();
}

console.log("\nmention picker — keyboard");
{
  const i = makeInput();
  typeInto(i, "@bo");
  await sleep(W);
  ok(rows()[0].classList.contains("active"), "first row starts highlighted");

  key(i, "ArrowDown");
  ok(rows()[1].classList.contains("active"), "ArrowDown moves the highlight");
  key(i, "ArrowUp");
  ok(rows()[0].classList.contains("active"), "ArrowUp moves it back");

  key(i, "ArrowUp");
  ok(rows()[2].classList.contains("active"), "ArrowUp from the top wraps to the bottom");
  key(i, "ArrowDown");
  ok(rows()[0].classList.contains("active"), "ArrowDown from the bottom wraps to the top");

  const ev = key(i, "Enter");
  ok(ev.defaultPrevented, "Enter is intercepted while the menu is open (does not submit)");
  ok(i.value === "@bob ", "Enter inserts the highlighted handle with a trailing space");
  ok(!menuVisible(), "menu closes after selection");
  i.remove();
}

{
  const i = makeInput();
  typeInto(i, "@bo");
  await sleep(W);
  const ev = key(i, "Escape");
  ok(ev.defaultPrevented, "Escape is intercepted");
  ok(!menuVisible(), "Escape closes the menu");
  // With the menu closed, Enter must fall through to the form again.
  const ev2 = key(i, "Enter");
  ok(!ev2.defaultPrevented, "Enter is NOT intercepted once the menu is closed");
  i.remove();
}

console.log("\nmention picker — insertion in a plain input");
{
  const i = makeInput();
  typeInto(i, "hey @bo");
  await sleep(W);
  key(i, "Enter");
  ok(i.value === "hey @bob ", "completion replaces only the partial handle");
  ok(i.selectionStart === "hey @bob ".length, "caret lands after the inserted handle");
  i.remove();
}

{
  // Completion mid-string must not eat the trailing text.
  const i = makeInput();
  i.value = "hey @bo world";
  i.setSelectionRange(7, 7);          // caret right after "@bo"
  i.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(W);
  key(i, "Enter");
  ok(i.value === "hey @bob  world", "text after the caret is preserved");
  i.remove();
}

{
  const i = makeInput();
  typeInto(i, "@bo");
  await sleep(W);
  rows()[1].dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  ok(i.value === "@bobby ", "clicking a row inserts that person");
  ok(!menuVisible(), "menu closes after a click");
  i.remove();
}

console.log("\nmention picker — contenteditable (post composer)");
{
  const area = document.createElement("div");
  area.setAttribute("contenteditable", "true");
  document.body.appendChild(area);
  // jsdom does not implement isContentEditable from the attribute.
  Object.defineProperty(area, "isContentEditable", { configurable: true, get: () => true });
  mod.attachMentionPicker(area);

  const text = document.createTextNode("hey @bo");
  area.appendChild(text);
  const range = document.createRange();
  range.setStart(text, 7); range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  area.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(W);
  ok(menuVisible(), "menu opens in a contenteditable area");

  key(area, "Enter");
  ok(text.nodeValue === "hey @bob ", "completion splices into the text node");
  ok(!menuVisible(), "menu closes after selection");
  area.remove();
}

console.log("\nmention picker — teardown");
{
  const i = makeInput();
  typeInto(i, "@bo");
  await sleep(W);
  ok(menuVisible(), "menu is open before navigation");
  window.dispatchEvent(new window.Event("hashchange"));
  ok(!menuVisible(), "navigation closes the menu");
  i.remove();
}

{
  const i = makeInput();
  mod.attachMentionPicker(i);   // second attach on the same field
  typeInto(i, "@bo");
  await sleep(W);
  apiCalls = [];
  typeInto(i, "@bob");
  await sleep(W);
  ok(apiCalls.length === 1, "attaching twice does not double-bind listeners");
  mod.hideMentionMenu(); i.remove();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
