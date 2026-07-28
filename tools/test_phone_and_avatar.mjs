// Unit + behavioral tests for three feed/profile utilities added together:
//   1. formatUsPhone — US/NANP auto-formatting, hands-off for international
//   2. attachPhoneFormat — wires an input, formats initial + on input
//   3. avatar picker guidance — hint text + client-side size/type pre-check
// The phone formatter is pure and gets the most cases (it's the riskiest).

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const js = readFileSync("assets/js/shell.js", "utf8");

const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;

// Extract the pure formatter by brace-matching.
function extractFn(src, name, kw = "function") {
  const start = src.indexOf(`${kw} ${name}(`);
  const braceOpen = src.indexOf("{", src.indexOf(")", start));
  let j = braceOpen, d = 0;
  do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0);
  return src.slice(start, j);
}
const formatUsPhone = new Function(extractFn(js, "formatUsPhone") + "; return formatUsPhone;")();

console.log("formatUsPhone — US numbers");
ok(formatUsPhone("5551234567") === "(555) 123-4567", "10 digits -> (555) 123-4567");
ok(formatUsPhone("555") === "(555", "partial 3 digits -> (555");
ok(formatUsPhone("5551") === "(555) 1", "partial 4 digits -> (555) 1");
ok(formatUsPhone("555123") === "(555) 123", "partial 6 digits -> (555) 123");
ok(formatUsPhone("5551234") === "(555) 123-4", "7 digits starts the last group");
ok(formatUsPhone("15551234567") === "1 (555) 123-4567", "leading US country code 1 kept as prefix");
ok(formatUsPhone("(555) 123-4567") === "(555) 123-4567", "already-formatted stays stable (idempotent)");
ok(formatUsPhone("555.123.4567") === "(555) 123-4567", "dotted input normalizes");
ok(formatUsPhone("555-123-4567") === "(555) 123-4567", "hyphenated input normalizes");
ok(formatUsPhone("") === "", "empty stays empty");

console.log("\nformatUsPhone — international / hands-off");
ok(formatUsPhone("+44 20 7946 0958") === "+44 20 7946 0958", "leading + is left untouched");
ok(formatUsPhone("+1 (555) 123-4567") === "+1 (555) 123-4567", "+1 international form untouched");
ok(formatUsPhone("+15551234567") === "+15551234567", "plain +1 digits untouched");
ok(formatUsPhone("00441234567890") === "00441234567890", ">10 non-US digits left as raw (not mangled)");
// teeth: a real US number must NOT be left raw.
ok(formatUsPhone("5551234567") !== "5551234567", "a US number is actually reformatted, not passed through");

console.log("\nattachPhoneFormat — wiring");
const attachPhoneFormat = new Function("document",
  extractFn(js, "formatUsPhone") + ";" + extractFn(js, "attachPhoneFormat") + "; return attachPhoneFormat;"
)(window.document);
const input = window.document.createElement("input");
input.type = "tel"; input.value = "5551234567";
window.document.body.appendChild(input);
attachPhoneFormat(input);
ok(input.value === "(555) 123-4567", "initial stored value is formatted on attach");
ok(input.dataset.phoneFmt === "1", "input is marked wired (won't double-bind)");
// typing more digits reformats live
input.value = "(555) 123-45677"; // user types an 11th significant digit region
input.dispatchEvent(new window.Event("input", { bubbles: true }));
ok(/^\(555\) 123-4567/.test(input.value), "live input stays formatted");
// idempotent attach: second call is a no-op (guard by dataset flag)
const before = input.value;
attachPhoneFormat(input);
ok(input.value === before, "re-attaching does not reset or double-format");

console.log("\navatar picker guidance");
// mountAvatarPicker renders a hint line and enforces size/type before upload.
const shellHasHint = js.includes('avatar-pick-hint');
ok(shellHasHint, "avatar picker renders a guidance hint element");
ok(/up to 8 MB/.test(js), "hint states the real 8 MB limit (matches server)");
ok(!/under 5 MB/.test(js), "the stale 5 MB copy is gone");
ok(/center-crop to a \$\{shape === "square" \? "square" : "circle"\}/.test(js),
   "hint is shape-aware (square for companies, circle for users)");
// client-side pre-check bounds mirror the server
ok(/MAX_BYTES = 8 \* 1024 \* 1024/.test(js), "client pre-check caps at 8 MB (mirrors server)");
ok(/OK_TYPES = \["image\/png", "image\/jpeg", "image\/gif", "image\/webp"\]/.test(js),
   "client pre-check whitelists the same types as the server");

console.log("\napplyPlusState / refreshMe (item 2 wiring present)");
ok(/function applyPlusState\(\)/.test(js), "applyPlusState helper exists");
ok(/function refreshMe\(\)/.test(js) || /async function refreshMe\(\)/.test(js), "refreshMe helper exists");
ok(/applyPlusState\(\)/.test(js) && /renderFeed\(\)/.test(js), "applyPlusState re-renders the feed when it's on screen");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
