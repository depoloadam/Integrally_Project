// test_rail_scroll.mjs — sticky side columns scroll independently.
//
// The feed's right rail and the profile's left column are position:sticky.
// Without a height bound, a rail taller than the viewport hides its
// overflow until the MAIN column scrolls past its end. These assertions
// lock in the fix: cap to viewport height + overflow-y:auto, reset on
// mobile where the columns are no longer sticky.
//
// Parses app.css directly (no browser needed).
// Run: node tools/test_rail_scroll.mjs

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "assets/css/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

// Collect top-level rules (selector -> body), tracking @media depth.
function rules(src) {
  const out = [];
  let depth = 0, sel = "", body = "", inBody = false, media = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      if (depth === 1 && sel.trim().startsWith("@media")) { media.push(sel.trim()); sel = ""; continue; }
      if (!inBody) { inBody = true; body = ""; continue; }
    }
    if (ch === "}") {
      depth--;
      if (inBody) { out.push({ sel: sel.trim().replace(/\s+/g, " "), body, media: media[media.length - 1] || null }); sel = ""; inBody = false; continue; }
      if (media.length && depth === 0) media.pop();
      continue;
    }
    if (inBody) body += ch; else sel += ch;
  }
  return out;
}
const all = rules(css);
const find = (selector, inMedia = null) =>
  all.filter(r => r.sel.split(",").map(s => s.trim()).includes(selector)
    && (inMedia === null ? !r.media : (r.media || "").includes(inMedia)));

const prop = (body, name) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

for (const [label, selector] of [["feed right rail", ".feed-rail-right"], ["profile left column", ".in-col-left"]]) {
  console.log(`${label} (${selector})`);
  const base = find(selector);
  ok(base.length > 0, "base rule exists outside any media query");
  const body = base.map(r => r.body).join(";");

  ok(prop(body, "position") === "sticky", "stays position:sticky");
  const mh = prop(body, "max-height");
  ok(!!mh && /100vh/.test(mh), `height capped to the viewport (${mh})`);
  ok(prop(body, "overflow-y") === "auto", "overflow-y:auto — scrolls on its own");
  ok(prop(body, "overscroll-behavior") === "contain", "overscroll-behavior:contain — no page lurch at the end");

  // The cap must subtract the sticky offset, or the bottom stays cut off.
  const top = prop(body, "top");
  ok(!!top && mh.includes(top.replace("px", "")), `cap accounts for the sticky top offset (top:${top}, max-height:${mh})`);
}

console.log("mobile reset (profile column is not sticky there)");
{
  const mob = find(".in-col-left", "760px");
  ok(mob.length > 0, "mobile override exists");
  const body = mob.map(r => r.body).join(";");
  ok(prop(body, "position") === "static", "position:static on mobile");
  ok(prop(body, "max-height") === "none", "viewport cap removed so the column flows");
  ok(prop(body, "overflow-y") === "visible", "overflow reset — not a short scroll box");
}

console.log("scrollbars are discreet (standard properties)");
{
  const raw = readFileSync(join(root, "assets/css/app.css"), "utf8");
  const bar = raw.slice(raw.indexOf("---- side-rail scrollbars ----"), raw.indexOf("/* profile header card */"));

  // Chromium honours the STANDARD scrollbar properties over
  // ::-webkit-scrollbar sizing whenever scrollbar-width is set (the
  // rails set it), so the rails MUST be styled via scrollbar-color.
  // The rest state used to be fully transparent, which left no signifier
  // that the rails scroll at all. It now rests at a faint tint — visible
  // enough to read as an affordance, still lighter than the hover state.
  const restRule = bar.match(/\.feed-rail-right,\s*\.in-col-left\s*\{([^}]*)\}/);
  ok(!!restRule && /scrollbar-color:\s*rgba\([^)]*\)\s+transparent/.test(restRule[1]),
     "rails: tinted (not transparent) scrollbar-color at rest");
  const restAlpha = restRule && parseFloat((restRule[1].match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/) || [])[1]);
  ok(restAlpha > 0 && restAlpha < 0.16,
     `rails: rest tint is subtle (alpha ${restAlpha})`);
  ok(/\.feed-rail-right:hover[^}]*scrollbar-color:\s*rgba/.test(bar.replace(/\n/g, "")),
     "rails: tinted scrollbar-color on hover");

  // The page bar (html has overflow-y:scroll) is the most visible one.
  ok(/html\s*\{\s*scrollbar-color:/.test(bar), "page scrollbar is styled, not Chrome's default grey");
  ok(/\[data-theme="dark"\]\s*html\s*\{\s*scrollbar-color:/.test(bar), "page scrollbar has a dark-theme variant");

  // Opacity ceiling: nothing should be heavy.
  const alphas = [...bar.matchAll(/rgba\((?:11,\s*31,\s*42|255,\s*255,\s*255),\s*\.(\d+)\)/g)]
    .map(m => parseFloat("0." + m[1]));
  ok(alphas.length > 0, `found ${alphas.length} thumb colours`);
  ok(Math.max(...alphas) <= 0.26, `all thumbs stay light (max alpha ${Math.max(...alphas)})`);

  // The webkit block is a fallback only — it must not apply where the
  // standard properties do, or it would fight them.
  ok(/@supports not \(scrollbar-color/.test(bar),
     "webkit rules are guarded as a fallback for browsers lacking scrollbar-color");
}

console.log("feed rail hides before it would crush the post column");
{
  const hid = find(".feed-rail-right", "920px");
  ok(hid.some(r => prop(r.body, "display") === "none"), "still display:none under 920px");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
