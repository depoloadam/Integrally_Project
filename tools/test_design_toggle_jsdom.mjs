// test_design_toggle_jsdom.mjs — design system: Professional (Ledger)
// skin as DEFAULT, "Alternate" (previous design) as the opt-out.
//
// Covers:
//   1. applyDesign(): "alternate" removes the attribute; anything else
//      applies pro; legacy "original" honored as alternate; persistence.
//   2. The REAL <head> boot script from app.html: default → pro before
//      paint; stored "alternate" OR legacy "original" → no attribute.
//   3. Appearance settings (real renderSetAppearance): Professional
//      active by default with no stored choice; Alternate active when
//      saved; clicks apply live + persist.
//   4. SCOPING GUARANTEE: every selector in pro.css contains
//      [data-design="pro"] — Alternate mode is byte-for-byte the
//      original design.
//
// Run: node tools/test_design_toggle_jsdom.mjs   (needs jsdom installed)

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellSrc   = readFileSync(join(root, "assets/js/shell.js"), "utf8");
const profileSrc = readFileSync(join(root, "assets/js/profile.js"), "utf8");
const appHtml    = readFileSync(join(root, "app.html"), "utf8");
const proCss     = readFileSync(join(root, "assets/css/pro.css"), "utf8");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else      { fail++; console.log("  ✗ " + name); }
}

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

const freshDom = () => new JSDOM(`<!doctype html><html><body><div id="panel"></div></body></html>`, { url: "http://localhost/" });

// The real inline boot script from app.html's <head>.
const bootMatch = appHtml.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/);

// =====================================================================
console.log("applyDesign() — default-pro semantics");
{
  const dom = freshDom();
  const { window } = dom;
  const applyDesign = new Function("document", "localStorage", extractFn(shellSrc, "applyDesign") + "; return applyDesign;")(window.document, window.localStorage);

  applyDesign("alternate");
  ok(!window.document.documentElement.hasAttribute("data-design"), "'alternate' removes data-design");
  ok(window.localStorage.getItem("in_design") === "alternate", "'alternate' persisted");

  applyDesign("pro");
  ok(window.document.documentElement.getAttribute("data-design") === "pro", "'pro' applies data-design=pro");
  ok(window.localStorage.getItem("in_design") === "pro", "'pro' persisted");

  applyDesign("original");   // legacy value from the preview phase
  ok(!window.document.documentElement.hasAttribute("data-design"), "legacy 'original' honored as alternate");
  ok(window.localStorage.getItem("in_design") === "alternate", "legacy 'original' migrated to 'alternate' in storage");

  applyDesign("garbage");
  ok(window.document.documentElement.getAttribute("data-design") === "pro", "unknown mode falls back to the DEFAULT (pro)");
}

// =====================================================================
console.log("head boot script (real, from app.html)");
{
  ok(!!bootMatch, "inline boot script present in app.html <head>");
  if (bootMatch) {
    const boot = new Function("document", "localStorage", bootMatch[1]);

    const d1 = freshDom();   // no stored choice → default pro
    boot(d1.window.document, d1.window.localStorage);
    ok(d1.window.document.documentElement.getAttribute("data-design") === "pro", "no stored choice → pro applied at boot (default)");

    const d2 = freshDom();   // alternate opt-out
    d2.window.localStorage.setItem("in_design", "alternate");
    boot(d2.window.document, d2.window.localStorage);
    ok(!d2.window.document.documentElement.hasAttribute("data-design"), "stored 'alternate' → attribute absent at boot");

    const d3 = freshDom();   // legacy original opt-out
    d3.window.localStorage.setItem("in_design", "original");
    boot(d3.window.document, d3.window.localStorage);
    ok(!d3.window.document.documentElement.hasAttribute("data-design"), "legacy 'original' → attribute absent at boot");

    const idx = appHtml.indexOf(bootMatch[0]);
    ok(idx > -1 && idx < appHtml.indexOf('<link rel="stylesheet"'), "boot script sits before the stylesheets (pre-paint)");
  }
}

// =====================================================================
console.log("Appearance settings control (real renderSetAppearance)");
{
  const build = (storedValue) => {
    const dom = freshDom();
    const { window } = dom;
    const document = window.document;
    if (storedValue) window.localStorage.setItem("in_design", storedValue);
    const panel = document.getElementById("panel");
    const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
    const $  = (id) => document.getElementById(id);
    const api = async () => ({ ok: true, data: { success: true } });
    const applyDesignReal = new Function("document", "localStorage", extractFn(shellSrc, "applyDesign") + "; return applyDesign;")(document, window.localStorage);
    const render = new Function("document", "localStorage", "el", "$", "api", "applyTheme", "applyReducedMotion", "applyDesign", "SETTINGS_DATA",
      extractFn(profileSrc, "renderSetAppearance") + "; return renderSetAppearance;")(document, window.localStorage, el, $, api, () => {}, () => {}, applyDesignReal, null);
    render(panel, { theme: "light", reduced_motion: "0" });
    return { window, document, panel };
  };

  {  // default: nothing stored → Professional active
    const { panel } = build(null);
    const proBtn = panel.querySelector('[data-design-opt="pro"]');
    const altBtn = panel.querySelector('[data-design-opt="alternate"]');
    ok(proBtn && altBtn, "options rendered: Professional + Alternate");
    ok(proBtn.classList.contains("active") && !altBtn.classList.contains("active"), "no stored choice → Professional shown active (default)");
  }
  {  // stored alternate → Alternate active; click Professional
    const { window, document, panel } = build("alternate");
    const proBtn = panel.querySelector('[data-design-opt="pro"]');
    const altBtn = panel.querySelector('[data-design-opt="alternate"]');
    ok(altBtn.classList.contains("active"), "stored 'alternate' → Alternate shown active");
    proBtn.click();
    ok(document.documentElement.getAttribute("data-design") === "pro", "clicking Professional applies pro live");
    ok(window.localStorage.getItem("in_design") === "pro", "clicking Professional persists");
    altBtn.click();
    ok(!document.documentElement.hasAttribute("data-design"), "clicking Alternate removes the attribute live");
    ok(window.localStorage.getItem("in_design") === "alternate", "clicking Alternate persists");
  }
  {  // legacy stored original → Alternate active
    const { panel } = build("original");
    ok(panel.querySelector('[data-design-opt="alternate"]').classList.contains("active"), "legacy 'original' → Alternate shown active");
  }
}

// =====================================================================
console.log("pro.css scoping guarantee (Alternate = original design exactly)");
{
  const css = proCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  let depth = 0, buf = "";
  for (const ch of css) {
    if (ch === "{") { if (depth === 0 && buf.trim()) selectors.push(buf.trim()); depth++; buf = ""; }
    else if (ch === "}") { depth--; buf = ""; }
    else if (depth === 0) buf += ch;
  }
  // Grouped selectors: every comma-separated part must carry the scope.
  const parts = selectors.flatMap(s => s.startsWith("@") ? [] : s.split(",").map(p => p.trim()).filter(Boolean));
  const unscoped = parts.filter(p => !p.includes('[data-design="pro"]'));
  ok(parts.length > 200, `parsed ${parts.length} selector parts from pro.css`);
  ok(unscoped.length === 0, "every selector part is scoped under [data-design=\"pro\"]" + (unscoped.length ? " — UNSCOPED: " + unscoped.slice(0,5).join(" | ") : ""));

  const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
  ok(open === close, `pro.css braces balanced (${open}/${close})`);
  ok(proCss.includes(':root[data-design="pro"]:not([data-theme="dark"])'), "light-palette override carries the :not(dark) guard");
  ok(proCss.includes(':root[data-design="pro"][data-theme="dark"]'), "explicit pro+dark accent block present");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
