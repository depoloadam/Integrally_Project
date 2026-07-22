// test_design_toggle_jsdom.mjs — design preview ("pro" skin) toggle
//
// Covers:
//   1. applyDesign() sets/removes data-design on <html> and persists to
//      localStorage (extracted from the REAL shell.js source).
//   2. The boot snippet restores a saved "pro" choice at script parse.
//   3. The Appearance settings control (extracted from the REAL
//      profile.js renderSetAppearance) renders both design options,
//      marks the saved one active, and clicking Professional applies
//      the attribute live + persists.
//   4. SCOPING GUARANTEE: every selector in pro.css contains
//      [data-design="pro"] — proving the file is inert when the toggle
//      is off, i.e. switching back restores the original design exactly.
//
// Run: node tools/test_design_toggle_jsdom.mjs   (needs jsdom installed)

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellSrc   = readFileSync(join(root, "assets/js/shell.js"), "utf8");
const profileSrc = readFileSync(join(root, "assets/js/profile.js"), "utf8");
const proCss     = readFileSync(join(root, "assets/css/pro.css"), "utf8");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else      { fail++; console.log("  ✗ " + name); }
}

// ---- function extraction (brace-matched from the params' closing paren,
// per the established pattern) ----------------------------------------
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const parenOpen = src.indexOf("(", start);
  let i = parenOpen, depth = 0;
  do { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; } while (depth > 0);
  const braceOpen = src.indexOf("{", i);
  let j = braceOpen; depth = 0;
  do { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; } while (depth > 0);
  return src.slice(start, j);
}

function freshDom() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="panel"></div></body></html>`, { url: "http://localhost/" });
  return dom;
}

// =====================================================================
console.log("applyDesign() core behavior");
{
  const dom = freshDom();
  const { window } = dom;
  const ctx = { document: window.document, localStorage: window.localStorage };
  const fn = new Function("document", "localStorage", extractFn(shellSrc, "applyDesign") + "; return applyDesign;");
  const applyDesign = fn(ctx.document, ctx.localStorage);

  applyDesign("pro");
  ok(window.document.documentElement.getAttribute("data-design") === "pro", "applyDesign('pro') sets data-design=pro on <html>");
  ok(window.localStorage.getItem("in_design") === "pro", "applyDesign('pro') persists 'pro' to localStorage");

  applyDesign("original");
  ok(!window.document.documentElement.hasAttribute("data-design"), "applyDesign('original') removes the attribute");
  ok(window.localStorage.getItem("in_design") === "original", "applyDesign('original') persists 'original'");

  applyDesign("garbage");
  ok(!window.document.documentElement.hasAttribute("data-design"), "unknown mode falls back to original (attribute absent)");
}

// =====================================================================
console.log("boot restore snippet");
{
  const dom = freshDom();
  const { window } = dom;
  window.localStorage.setItem("in_design", "pro");
  // Execute the real boot snippet from shell.js source.
  const m = shellSrc.match(/try \{\n  if \(localStorage\.getItem\("in_design"\)[\s\S]*?catch \(_\) \{ \/\* storage blocked — original design \*\/ \}/);
  ok(!!m, "boot snippet present in shell.js");
  if (m) {
    new Function("document", "localStorage", m[0])(window.document, window.localStorage);
    ok(window.document.documentElement.getAttribute("data-design") === "pro", "saved 'pro' choice is applied at boot");
  }

  const dom2 = freshDom();
  if (m) {
    new Function("document", "localStorage", m[0])(dom2.window.document, dom2.window.localStorage);
    ok(!dom2.window.document.documentElement.hasAttribute("data-design"), "no saved choice → original design at boot");
  }
}

// =====================================================================
console.log("Appearance settings control (real renderSetAppearance)");
{
  const dom = freshDom();
  const { window } = dom;
  const document = window.document;
  const panel = document.getElementById("panel");

  // Stubs matching the shell environment.
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const $  = (id) => document.getElementById(id);
  const api = async () => ({ ok: true, data: { success: true } });
  const applyTheme = () => {};
  const applyReducedMotion = () => {};
  const applyDesignReal = new Function("document", "localStorage", extractFn(shellSrc, "applyDesign") + "; return applyDesign;")(document, window.localStorage);

  window.localStorage.setItem("in_design", "pro");   // saved state: pro

  const src = extractFn(profileSrc, "renderSetAppearance");
  const render = new Function("document", "localStorage", "el", "$", "api", "applyTheme", "applyReducedMotion", "applyDesign", "SETTINGS_DATA",
    src + "; return renderSetAppearance;")(document, window.localStorage, el, $, api, applyTheme, applyReducedMotion, applyDesignReal, null);

  render(panel, { theme: "light", reduced_motion: "0" });

  const opts = panel.querySelectorAll("[data-design-opt]");
  ok(opts.length === 2, "two design options rendered (Original / Professional)");
  const proBtn  = panel.querySelector('[data-design-opt="pro"]');
  const origBtn = panel.querySelector('[data-design-opt="original"]');
  ok(proBtn && proBtn.classList.contains("active"), "saved 'pro' choice renders as the active option");
  ok(origBtn && !origBtn.classList.contains("active"), "Original not active when 'pro' is saved");

  // Click Original → attribute removed, persisted, active class moves.
  origBtn.click();
  ok(!document.documentElement.hasAttribute("data-design"), "clicking Original removes data-design live");
  ok(window.localStorage.getItem("in_design") === "original", "clicking Original persists the choice");
  ok(origBtn.classList.contains("active") && !proBtn.classList.contains("active"), "active class follows the click");

  // Click Professional → applied live + persisted.
  proBtn.click();
  ok(document.documentElement.getAttribute("data-design") === "pro", "clicking Professional applies data-design=pro live");
  ok(window.localStorage.getItem("in_design") === "pro", "clicking Professional persists the choice");
}

// =====================================================================
console.log("pro.css scoping guarantee (inert when toggle off)");
{
  // Strip comments, then check every rule's selector list.
  const css = proCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  let depth = 0, buf = "";
  for (const ch of css) {
    if (ch === "{") { if (depth === 0 && buf.trim()) selectors.push(buf.trim()); depth++; buf = ""; }
    else if (ch === "}") { depth--; buf = ""; }
    else if (depth === 0) buf += ch;
  }
  const unscoped = selectors.filter(s => !s.startsWith("@") && !s.includes('[data-design="pro"]'));
  ok(selectors.length > 10, `parsed ${selectors.length} top-level selectors from pro.css`);
  ok(unscoped.length === 0, "every selector is scoped under [data-design=\"pro\"]" + (unscoped.length ? " — UNSCOPED: " + unscoped.join(" | ") : ""));

  // Braces balance (cheap syntax sanity).
  const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
  ok(open === close, `pro.css braces balanced (${open} open / ${close} close)`);

  // The dark-theme guard exists so pro light vars can't clobber dark mode.
  ok(proCss.includes(':root[data-design="pro"]:not([data-theme="dark"])'), "light-palette override carries the :not(dark) guard");
  ok(proCss.includes(':root[data-design="pro"][data-theme="dark"]'), "explicit pro+dark accent block present");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
