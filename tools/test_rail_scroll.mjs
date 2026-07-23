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

console.log("scrollbars are discreet (invisible at rest, reveal on hover)");
{
  const raw = readFileSync(join(root, "assets/css/app.css"), "utf8");
  const bar = raw.slice(raw.indexOf("Near-invisible scrollbar"), raw.indexOf("/* profile header card */"));
  ok(/::-webkit-scrollbar\s*,?[\s\S]{0,80}width:\s*6px/.test(bar), "webkit scrollbar narrowed to 6px");
  ok(/::-webkit-scrollbar-track[\s\S]{0,80}background:\s*transparent/.test(bar), "track never paints");
  // The at-rest thumb rule (not the :hover ones) must be transparent.
  const restThumb = bar.split(":hover")[0];
  ok(/::-webkit-scrollbar-thumb[\s\S]{0,120}background:\s*transparent/.test(restThumb),
     "thumb is fully transparent at rest");
  ok(/:hover::-webkit-scrollbar-thumb/.test(bar), "thumb reveals on column hover");
  ok(/transition:\s*background-color/.test(bar), "reveal is eased, not abrupt");
  ok(/\[data-theme="dark"\][\s\S]{0,200}::-webkit-scrollbar-thumb/.test(bar), "dark theme variant present");
  // Chromium ignores ::-webkit-scrollbar-* when scrollbar-color is set, so
  // the Firefox properties must stay behind @supports.
  ok(/@supports \(-moz-appearance:none\)/.test(bar), "Firefox scrollbar-color scoped behind @supports");
  const outsideSupports = bar.slice(0, bar.indexOf("@supports"));
  ok(!/scrollbar-color/.test(outsideSupports),
     "no unguarded scrollbar-color (would disable the webkit thumb styling)");
}

console.log("feed rail hides before it would crush the post column");
{
  const hid = find(".feed-rail-right", "920px");
  ok(hid.some(r => prop(r.body, "display") === "none"), "still display:none under 920px");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
