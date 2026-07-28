// Behavioral check for the secondary nav bar.
//
// Two layers:
//   1. DOM/behaviour  — extracts the REAL setSubnav + the real delegated
//      click handler wiring from shell.js and runs them against the REAL
//      sub-nav markup lifted out of app.html.
//   2. CSS contract   — resolves the --in-nav-h/--in-subnav-h custom
//      properties by hand and asserts the sticky offset the search bar
//      inherits in BOTH states (sub-nav present / absent).
//
// NOTE ON SCOPE: jsdom does not implement calc(), custom-property
// resolution, or sticky layout, so layer 2 resolves the cascade manually
// rather than reading getComputedStyle. It verifies the arithmetic and the
// declarations, NOT real paint geometry. A browser check is still worth
// running in-page (see handoff).
//
// Every matcher below is paired with a sanity assertion proving it rejects
// the wrong input — a test that cannot fail is worse than no test.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const html = readFileSync("app.html", "utf8");
const js   = readFileSync("assets/js/shell.js", "utf8");
const css  = readFileSync("assets/css/app.css", "utf8");

// ---------------------------------------------------------------- layer 0
// Sanity: prove the file readers actually loaded content, so later
// "contains" assertions can't pass vacuously against an empty string.
console.log("\nsanity — matchers reject wrong input");
ok(html.includes("in-subnav") && !html.includes("__nope__"), "html matcher accepts real / rejects fake");
ok(js.includes("setSubnav") && !js.includes("__nope__"), "js matcher accepts real / rejects fake");
ok(css.includes("--in-nav-h") && !css.includes("__nope__"), "css matcher accepts real / rejects fake");

// ---------------------------------------------------------------- layer 1
console.log("\nmarkup");
const dom = new JSDOM(html, { url: "http://localhost/" });
const { window } = dom;
const document = window.document;

const subnav = document.getElementById("subnav");
const inner  = document.getElementById("subnav-inner");
ok(!!subnav, "#subnav exists");
ok(!!inner, "#subnav-inner exists");

// Order matters: the bar must sit between the nav and the search bar, or
// the sticky stack paints out of sequence.
const nav = document.querySelector("nav.in-nav");
const searchbar = document.getElementById("searchbar");
ok(!!nav && !!searchbar, "nav + searchbar present");
const pos = (a, b) => a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING;
ok(pos(nav, subnav), "sub-nav comes after the nav");
ok(pos(subnav, searchbar), "search bar comes after the sub-nav");

// The bar must NOT carry an inline display — visibility is class-driven so
// the height var flips with it.
ok(!subnav.getAttribute("style"), "sub-nav has no inline style (class-driven visibility)");

const plusBtn = inner.querySelector('[data-subnav="plus"]');
ok(!!plusBtn, "Try PLUS+ button exists");
ok(plusBtn && plusBtn.textContent.trim() === "Try PLUS+", "button label is exactly 'Try PLUS+'");
ok(plusBtn && plusBtn.classList.contains("in-subnav-btn"), "button carries shared geometry class");
ok(plusBtn && plusBtn.classList.contains("gold"), "button carries the .gold look modifier");
ok(plusBtn && !plusBtn.classList.contains("accent"),
   "button does NOT use the teal .accent look (upsell must not read as a primary action)");
// Guard the variant system: geometry and appearance must stay separable.
for (const v of [".in-subnav-btn.accent", ".in-subnav-btn.outline", ".in-subnav-btn.gold"]) {
  ok(css.includes(v), "look modifier " + v + " exists independent of .in-subnav-btn");
}

console.log("\nsearch moved into the sub-nav, right-aligned");
const searchTrigger = document.getElementById("search-trigger");
ok(!!searchTrigger, "#search-trigger still exists (id unchanged, so search.js wiring holds)");
ok(!!searchTrigger && inner.contains(searchTrigger), "search trigger lives inside the sub-nav now");
const navLinks = document.querySelector(".in-nav-links");
ok(navLinks && !navLinks.contains(searchTrigger), "search trigger no longer in .in-nav-links");
// Right-alignment: the sub-nav scope gives it margin-left:auto.
const navsearchRule = /\.in-subnav \.in-navsearch \{([^}]*)\}/.exec(css);
ok(!!navsearchRule && /margin-left:auto/.test(navsearchRule[1]),
   "search is pushed right (margin-left:auto in sub-nav scope)");
// It keeps its own handler, so the delegated data-subnav dispatch must
// ignore it — it carries no data-subnav attribute.
ok(searchTrigger && !searchTrigger.hasAttribute("data-subnav"),
   "search is not a data-subnav item (its own handler owns it)");
ok(plusBtn.compareDocumentPosition(searchTrigger) & window.Node.DOCUMENT_POSITION_FOLLOWING,
   "search comes after Try PLUS+ in the bar");
// Sub-nav search styling must not carry over to the base .in-navsearch
// used elsewhere — the override is scoped.
ok(/\.in-subnav \.in-navsearch/.test(css), "search overrides are scoped to .in-subnav");

console.log("\nsetSubnav()");
// Extract and run the REAL function rather than a re-implementation.
const m = js.match(/function setSubnav\(show\)\s*\{[\s\S]*?\n\}/);
ok(!!m, "setSubnav extracted from shell.js");
const setSubnav = new Function("document", m[0] + "; return setSubnav;")(document);

setSubnav(false);
ok(!document.documentElement.classList.contains("has-subnav"), "false -> class removed");
setSubnav(true);
ok(document.documentElement.classList.contains("has-subnav"), "true -> class added");
setSubnav(true);
ok(document.documentElement.className.match(/has-subnav/g).length === 1, "idempotent, no duplicate class");
setSubnav(false);
ok(!document.documentElement.classList.contains("has-subnav"), "toggles back off");

console.log("\nauth wiring");
// The three identity branches must each make a call, and companies must
// be the only one hiding the bar.
const userBranch = js.indexOf('$("profile-menu").style.display = "";');
const coBranch   = js.indexOf("setupCompanyIdentityNav()");
const outBranch  = js.indexOf('$("auth-menu").style.display = "";');
ok(userBranch > -1 && coBranch > -1 && outBranch > -1, "located all three identity branches");
const near = (idx, needle, span = 500) => js.slice(Math.max(0, idx - span), idx + span).includes(needle);
ok(near(userBranch, "setSubnav(true)"), "signed-in user -> bar shown (hosts search)");
ok(near(userBranch, 'setPlusCta(!(ME && ME.plan === "plus"))'), "signed-in user -> Plus CTA hidden only if already Plus");
ok(near(coBranch, "setSubnav(true)"), "company -> bar shown (identical bar, hosts search)");
ok(near(coBranch, "setPlusCta(false)"), "company -> Plus CTA hidden (member-only offer)");
ok(near(outBranch, "setSubnav(false)"), "signed out -> bar hidden (nothing left in it)");
ok(near(outBranch, "setPlusCta(false)"), "signed out -> Plus CTA hidden");
// teeth: the user branch must NOT collapse the whole bar based on plan —
// that was the bug (hiding the bar also hid search for Plus users).
ok(!near(userBranch, 'setSubnav(!(ME && ME.plan === "plus"))'), "user branch no longer hides the whole bar for Plus users");
// teeth: company must NOT hide the whole bar anymore (that hid its search).
ok(!near(coBranch, "setSubnav(false)"), "company branch no longer collapses the bar");
// Sanity: the 'near' matcher must reject something that isn't there.
ok(!near(coBranch, "setSubnav(__nope__)"), "near() rejects absent text");

// Behavioral: extract the REAL setPlusCta and verify it hides ONLY the
// button, leaving the bar (and thus search) intact. This is the regression
// guard for the reported bug: hiding the CTA must not collapse the bar.
// Reuses the module-scope plusBtn / searchTrigger resolved earlier.
console.log("\nplus CTA hides button, not the whole bar");
const pm = js.match(/function setPlusCta\(show\)\s*\{[\s\S]*?\n\}/);
ok(!!pm, "setPlusCta extracted from shell.js");
const setPlusCta = new Function("document", pm[0] + "; return setPlusCta;")(document);

const gatePlus = (ME) => !(ME && ME.plan === "plus");
// The identity branches set search visibility themselves; the CTA toggle
// must not touch it. Simulate the branch's search state, then prove
// setPlusCta leaves it exactly as-is.
// free user: branch shows search
searchTrigger.style.display = "inline-flex";
setSubnav(true); setPlusCta(gatePlus({ plan: "free" }));
ok(document.documentElement.classList.contains("has-subnav"), "free user: bar visible");
ok(plusBtn.style.display !== "none", "free user: Plus button visible");
ok(searchTrigger.style.display === "inline-flex", "free user: search left visible by CTA toggle");
// PLUS user: bar STILL shown, button hidden, search untouched  <-- the bug
searchTrigger.style.display = "inline-flex";
setSubnav(true); setPlusCta(gatePlus({ plan: "plus" }));
ok(document.documentElement.classList.contains("has-subnav"), "Plus user: bar STILL visible (search preserved)");
ok(plusBtn.style.display === "none", "Plus user: only the Plus button is hidden");
ok(searchTrigger.style.display === "inline-flex", "Plus user: search trigger untouched by the CTA toggle");
// COMPANY: identical to a Plus user — bar shown, search shown, no Plus button.
searchTrigger.style.display = "inline-flex";
setSubnav(true); setPlusCta(false);
ok(document.documentElement.classList.contains("has-subnav"), "company: bar visible (identical bar)");
ok(plusBtn.style.display === "none", "company: no Plus button");
ok(searchTrigger.style.display === "inline-flex", "company: search present, same as members");
// signed-out: button hidden AND bar collapsed (search also hidden elsewhere)
setPlusCta(false); setSubnav(false);
ok(!document.documentElement.classList.contains("has-subnav"), "signed-out: bar collapsed");
ok(plusBtn.style.display === "none", "signed-out: Plus button hidden");
// defensive: no plan field -> treated as non-Plus, button shown
setSubnav(true); setPlusCta(gatePlus({}));
ok(plusBtn.style.display !== "none", "user without a plan field: button shown (treated non-Plus)");





console.log("\nclick -> coming-soon notice");
// Rebuild the delegated handler exactly as shell.js registers it.
let toasted = [];
const handlerSrc = js.match(/subnavInner\.addEventListener\("click",[\s\S]*?\n  \}\);/);
ok(!!handlerSrc, "delegated click handler extracted");
const attach = new Function("subnavInner", "toast",
  "subnavInner." + handlerSrc[0].slice(handlerSrc[0].indexOf("addEventListener")));
attach(inner, (msg) => toasted.push(msg));

plusBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(toasted.length === 1, "clicking Try PLUS+ fires exactly one notice");
ok(/coming soon/i.test(toasted[0] || ""), "notice says it's coming soon");
ok(/PLUS\+/.test(toasted[0] || ""), "notice uses the PLUS+ name, matching the button");
// It must not navigate — Plus has no route yet.
ok(window.location.hash === "", "click does not change the route");

// An unrelated click inside the bar must not fire the notice.
toasted = [];
inner.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(toasted.length === 0, "clicking bar background fires nothing");

// Clicking search must not trigger the PLUS notice — it's not a
// data-subnav item, so the delegated handler ignores it.
toasted = [];
searchTrigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(toasted.length === 0, "clicking search fires no sub-nav notice (own handler owns it)");

// ---------------------------------------------------------------- layer 2
console.log("\nCSS contract — sticky offset arithmetic");

// Strip @media blocks (brace-matched) so we assert the BASE rule. Without
// this, responsive overrides like `.in-col-left { top:auto }` at 760px win
// the "last declaration" race and mask the real desktop value.
const stripAtRules = (src) => {
  let out = "", i = 0;
  while (i < src.length) {
    const at = src.indexOf("@media", i);
    if (at === -1) { out += src.slice(i); break; }
    out += src.slice(i, at);
    let j = src.indexOf("{", at), d = 0;
    do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0 && j < src.length);
    i = j;
  }
  return out;
};
const baseCss = stripAtRules(css);

const declValue = (selector, prop, src = baseCss) => {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
  let val = null, mm;
  while ((mm = re.exec(src))) {
    const d = new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*([^;]+)").exec(mm[1]);
    if (d) val = d[1].trim();
  }
  return val;
};

// Sanity: prove the stripper on synthetic input, where the answer is known.
// (Asserting against the real file is unreliable — prose inside CSS
// comments legitimately mentions breakpoints the stripper never touches.)
const synth = "a{top:1px}@media (max-width:9px){a{top:2px}b{top:3px}}c{top:4px}";
const stripped = stripAtRules(synth);
ok(stripped === "a{top:1px}c{top:4px}", "stripAtRules removes @media blocks, keeps base rules");
ok(stripAtRules("a{top:1px}") === "a{top:1px}", "stripAtRules leaves media-free CSS untouched");
ok(declValue("a", "top", synth) === "2px" && declValue("a", "top", stripped) === "1px",
   "stripping actually changes the answer (naive lookup would take the override)");
// And the real-world case this was written for.
ok(declValue(".in-col-left", "top", css) === "auto",
   "naive whole-file lookup would have returned the mobile override");

const navH    = declValue(":root", "--in-nav-h");
const subH0   = declValue(":root", "--in-subnav-h");
const subH1   = declValue("html.has-subnav", "--in-subnav-h");
const barTop  = declValue(".in-searchbar", "top");
const headerHRaw = declValue(":root", "--in-header-h");
const navInner = declValue(".in-nav-inner", "height");
const subInner = declValue(".in-subnav-inner", "height");

ok(navH === "58px", "--in-nav-h is 58px (unchanged nav height)");
ok(subH0 === "0px", "--in-subnav-h defaults to 0 (bar absent)");
ok(subH1 === "30px", "--in-subnav-h is 30px under .has-subnav");
ok(navInner === "var(--in-nav-h)", "nav height reads the var, not a literal");
ok(subInner === "var(--in-subnav-h)", "sub-nav height reads the var, not a literal");
ok(barTop === "var(--in-header-h)", "search bar offsets by the composed header var");

// Resolve the calc by hand for both states.
const resolve = (expr, vars) => {
  const substituted = expr
    .replace(/^calc\(/, "(")
    .replace(/var\((--[a-z-]+)\)/g, (_, name) => vars[name]);
  const nums = substituted.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return nums.reduce((a, b) => a + b, 0);
};
const collapsed = resolve(headerHRaw, { "--in-nav-h": navH, "--in-subnav-h": subH0 });
const expanded  = resolve(headerHRaw, { "--in-nav-h": navH, "--in-subnav-h": subH1 });
ok(collapsed === 58, "no sub-nav -> search bar sticks at 58px (flush under nav)");
ok(expanded === 88, "sub-nav shown -> search bar sticks at 88px (flush under both)");
// Sanity: the resolver must produce a different, wrong answer for bad input.
ok(resolve(headerHRaw, { "--in-nav-h": "10px", "--in-subnav-h": "1px" }) === 11, "resolver is not hardcoded");

// The regression this guards: a literal offset would strand the bar.
ok(!/top:\s*58px/.test(css), "no literal top:58px survives anywhere in app.css");

console.log("\nsticky page furniture tracks the header");
// Regression guard: the rails and settings nav used to hardcode top:78px
// (nav 58 + 20 gutter). With the sub-nav shown that put them 38px too high,
// tucked under the bar. They must offset by the composed var instead.
const headerH   = declValue(":root", "--in-header-h");
const stickyTop = declValue(":root", "--in-sticky-top");
ok(headerH === "calc(var(--in-nav-h) + var(--in-subnav-h))", "--in-header-h composes both bars");
ok(stickyTop === "calc(var(--in-header-h) + 20px)", "--in-sticky-top adds the 20px gutter");
ok(!/78px/.test(css), "no literal 78px offset survives anywhere in app.css");

for (const sel of [".in-col-left", ".feed-rail-right", ".in-set-nav"]) {
  const t = declValue(sel, "top");
  ok(t === "var(--in-sticky-top)", sel + " offsets by the var, not a literal");
}
for (const sel of [".in-col-left", ".feed-rail-right"]) {
  const mh = declValue(sel, "max-height");
  ok(mh === "calc(100vh - var(--in-sticky-top) - 16px)", sel + " cap subtracts the same var");
}

// Resolve the nested calc for both states.
const resolveSticky = (subH) => {
  const hdr = resolve(headerH, { "--in-nav-h": navH, "--in-subnav-h": subH });
  return resolve(stickyTop, { "--in-header-h": hdr + "px" });
};
ok(resolveSticky(subH0) === 78, "no sub-nav -> rails stick at 78px (unchanged from before)");
ok(resolveSticky(subH1) === 108, "sub-nav shown -> rails stick at 108px (clear of the bar)");
ok(resolveSticky("5px") === 83, "sticky resolver is not hardcoded");

console.log("\nstacking order");
const zOf = (sel) => parseInt(declValue(sel, "z-index"), 10);
const zNav = zOf(".in-nav"), zSub = zOf(".in-subnav"), zBar = zOf(".in-searchbar");
ok(zNav > zSub, "nav paints above sub-nav (" + zNav + " > " + zSub + ")");
ok(zSub > zBar, "sub-nav paints above search bar (" + zSub + " > " + zBar + ")");

console.log("\ngold variant contrast (WCAG AA)");
// The gold fill is a gradient, so the text must clear AA against BOTH
// stops, in both themes. This is the assertion that would have caught
// white-on-gold (~2:1).
const srgb = (h) => {
  const v = h.replace("#", "");
  const f = v.length === 3 ? v.split("").map(c => c + c) : v.match(/../g);
  return f.map(x => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
};
const lum = (h) => { const [r, g, b] = srgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
// Sanity: the formula must reproduce known values before we trust it.
ok(Math.abs(ratio("#ffffff", "#000000") - 21) < 0.01, "contrast formula: white/black is 21:1");
ok(Math.abs(ratio("#ffffff", "#ffffff") - 1) < 0.01, "contrast formula: identical colours are 1:1");

for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']]) {
  const gold   = declValue(sel, "--in-gold");
  const goldLt = declValue(sel, "--in-gold-lt");
  const ink    = declValue(sel, "--in-gold-ink");
  ok(!!gold && !!goldLt && !!ink, theme + ": gold palette vars defined");
  const worst = Math.min(ratio(ink, gold), ratio(ink, goldLt));
  ok(worst >= 4.5, theme + ": ink on gold clears AA (" + worst.toFixed(2) + ":1)");
  // And prove the check has teeth: white would fail here.
  ok(Math.min(ratio("#ffffff", gold), ratio("#ffffff", goldLt)) < 4.5,
     theme + ": white-on-gold would fail, so the check is meaningful");
}

console.log("\nbar fits its content");
// The bar is now 30px. If an item's box grows past that, the flex row
// silently overflows and the text clips — assert the arithmetic.
const px = (v) => parseFloat(v);
const btnFont = declValue(".in-subnav-btn", "font-size");
const btnPad  = declValue(".in-subnav-btn", "padding");
const btnLh   = declValue(".in-subnav-btn", "line-height");
const btnBorder = declValue(".in-subnav-btn", "border");
ok(px(btnFont) <= 12, "item text is small (" + btnFont + ")");
const padY = px(btnPad.split(/\s+/)[0]);
const borderY = px(btnBorder) || 0;
const btnBox = px(btnFont) * parseFloat(btnLh) + padY * 2 + borderY * 2;
ok(btnBox <= px(subH1), "item box " + btnBox.toFixed(1) + "px fits the " + subH1 + " bar");
// Teeth: a 20px font would not fit, so the check isn't vacuous.
ok(20 * parseFloat(btnLh) + padY * 2 + borderY * 2 > px(subH1), "fit check rejects oversized text");

console.log("\nbar surface is flat, gradient is on the button");
// The gradient belongs to the CTA, not the bar. A gradient on both makes
// the button disappear into the surface.
// The rule has two background lines: a literal fallback then the var
// form. Assert the var form is present (declValue only sees the first),
// and that neither is a gradient.
const subFullBlock = /\.in-subnav\s*\{([^}]*)\}/.exec(css)[1];
ok(/background:\s*var\(--in-subnav-bg(,\s*#[0-9a-fA-F]{3,6})?\)/.test(subFullBlock),
   "sub-nav background is the themed var (with optional literal fallback)");
ok(!/gradient/.test(subFullBlock), "sub-nav background is NOT a gradient");

// STRUCTURAL: the .in-subnav rule must live at the top level, not nested
// inside an @media block. A broken comment once swallowed the whole
// secondary-nav section into a max-width media query, so the bar only
// rendered on narrow screens. This asserts the rule applies unconditionally.
{
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(css.split("/*").length === css.split("*/").length, "CSS comment markers are balanced (no orphaned /* or */)");
  const idx = noComments.indexOf(".in-subnav {");
  ok(idx > -1, "found .in-subnav rule after stripping comments");
  const before = noComments.slice(0, idx);
  const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
  ok(depth === 0, "the .in-subnav rule is top-level, not trapped inside an @media block (depth " + depth + ")");
  // teeth: prove the depth check would catch nesting.
  const faux = "@media(max-width:1px){ .x{} " + noComments.slice(idx);
  const fbefore = faux.slice(0, faux.indexOf(".in-subnav {"));
  ok(((fbefore.match(/\{/g) || []).length - (fbefore.match(/\}/g) || []).length) > 0, "depth check rejects a nested rule");
}

const goldBg = declValue(".in-subnav-btn.gold", "background");
ok(/^linear-gradient\(/.test(goldBg || ""), "gold button background IS a gradient");
ok(/var\(--in-gold\)/.test(goldBg) && /var\(--in-gold-lt\)/.test(goldBg),
   "gold gradient stops are themed vars, not literals");

for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']]) {
  const bg = declValue(sel, "--in-subnav-bg");
  ok(!!bg, theme + ": flat bar colour defined");
  // The button gradient must be strong enough to read at 30px.
  const g = declValue(sel, "--in-gold"), gl = declValue(sel, "--in-gold-lt");
  const amp = ratio(g, gl);
  ok(amp >= 1.4, theme + ": button gradient is visible (" + amp.toFixed(3) + ":1)");
  ok(ratio("#eab308", "#f7d154") < 1.4, theme + ": amplitude check rejects the old faint pair");
  // The CTA must also separate from the bar it sits on.
  ok(ratio(g, bg) >= 1.3, theme + ": gold reads against the bar (" + ratio(g, bg).toFixed(2) + ":1)");
}

console.log("\nquiet item legibility on the bar");
// Small text on a tinted surface is where this gets lost. --in-muted is
// far too faint on this teal, so quiet items use --in-ink-soft.
const quietColor = declValue(".in-subnav-btn", "color");
ok(quietColor === "var(--in-ink-soft)", "quiet items use --in-ink-soft, not --in-muted");
for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']]) {
  const bg = declValue(sel, "--in-subnav-bg");
  const soft = ratio(declValue(sel, "--in-ink-soft"), bg);
  ok(soft >= 4.5, theme + ": quiet text clears AA on the bar (" + soft.toFixed(2) + ":1)");
  const muted = ratio(declValue(sel, "--in-muted"), bg);
  ok(muted < soft, theme + ": --in-muted would be worse (" + muted.toFixed(2) + ":1), so the choice matters");
}

// Hover uses --in-gold-d, so the label must stay readable there too.
for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']]) {
  const hov = ratio(declValue(sel, "--in-gold-ink"), declValue(sel, "--in-gold-d"));
  ok(hov >= 4.5, theme + ": gold label clears AA on hover fill (" + hov.toFixed(2) + ":1)");
}

console.log("\nsearch item legibility");
// Search is borderless ink-soft text on the bar at rest, and on the
// hover wash on hover — both must clear AA in both themes.
for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']]) {
  const soft  = declValue(sel, "--in-ink-soft");
  const bar   = declValue(sel, "--in-subnav-bg");
  const hover = declValue(sel, "--in-subnav-hover");
  ok(!!hover, theme + ": --in-subnav-hover defined");
  ok(ratio(soft, bar) >= 4.5, theme + ": search label clears AA at rest (" + ratio(soft, bar).toFixed(2) + ":1)");
  ok(ratio(declValue(sel, "--in-ink"), hover) >= 4.5,
     theme + ": search label clears AA on hover wash (" + ratio(declValue(sel, "--in-ink"), hover).toFixed(2) + ":1)");
  // The hover wash must actually differ from the bar, or hover is invisible.
  ok(ratio(bar, hover) >= 1.08 && ratio(bar, hover) < 1.5,
     theme + ": hover wash is a subtle step off the bar (" + ratio(bar, hover).toFixed(3) + ":1)");
}

console.log("\ntheming");
// Dark mode is pure var overrides, so the bar must not hardcode colours.
const subBlock = /\.in-subnav\s*\{([^}]*)\}/.exec(css)[1];
ok(/background:var\(--in-subnav-bg(,\s*#[0-9a-fA-F]{3,6})?\)/.test(subBlock)
   && /border-bottom:1px solid var\(--in-line\)/.test(subBlock),
   "sub-nav surface and border are var-driven (inherits dark mode)");
// The only permitted hex in the surface rule is the fallback literal(s)
// inside var(..., #hex) — a stale-deploy safety net. Strip those, then
// assert nothing else hardcodes a colour.
const subBlockNoFallback = subBlock.replace(/var\([^)]*#[0-9a-fA-F]{3,6}\)/g, "var()").replace(/^\s*background:#[0-9a-fA-F]{3,6};\s*$/gm, "");
ok(!/#[0-9a-fA-F]{3,6}/.test(subBlockNoFallback), "no raw hex in the .in-subnav surface rule beyond the var fallback");
const subRules = (css.match(/\.in-subnav[^{]*\{[^}]*\}/g) || []).join("")
  // strip intentional fallback literals: var(..., #hex) and the paired
  // `background:#hex;` safety line that precedes the var form.
  .replace(/var\([^)]*#[0-9a-fA-F]{3,6}\)/g, "var()")
  .replace(/background:#[0-9a-fA-F]{3,6};/g, "");
const hexes = subRules.match(/#[0-9a-fA-F]{3,6}/g) || [];
ok(hexes.every(h => h.toLowerCase() === "#fff"),
   "no unthemed hex colours besides #fff on the accent label (fallbacks exempt)");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
