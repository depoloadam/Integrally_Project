// Generate the systematic geometry layer of pro.css from app.css:
// every radius normalized to the Ledger scale, every circle squared,
// with a curated exception list for shapes that carry affordance.
const fs = require("fs");
const css = fs.readFileSync("assets/css/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [];
let depth = 0, sel = "", body = "", inBody = false;
for (const ch of css) {
  if (ch === "{") { depth++; if (depth === 1) { inBody = true; body = ""; continue; } }
  if (ch === "}") { depth--; if (depth === 0 && inBody) { rules.push([sel.trim().replace(/\s+/g, " "), body]); sel = ""; inBody = false; continue; } }
  if (inBody) body += ch; else sel += ch;
}

// Shapes that keep their geometry: switch knob + track (affordance),
// status/step dots, strength-meter dots/checks, functional scale bars,
// and the avatar-shape picker previews (they must preview truthfully).
const KEEP = new Set([
  ".in-toggle", ".in-toggle-knob", ".in-notif-dot", ".in-str-dot",
  ".in-strp-check", ".avatar-pick-preview.circle", ".rt-color-bar",
]);
// Asymmetric message bubbles keep their tail cue at Ledger scale.
const SPECIAL = {
  ".in-msg-bubble": "6px 6px 6px 2px",
  ".in-msg-bubble-row.mine .in-msg-bubble": "6px 6px 2px 6px",
};
const to4 = new Set(["999px","99px","22px","20px","9px","8px","7px"]);
const to6 = new Set(["18px","16px","14px","12px","11px","10px"]);

const out4 = [], out6 = [], sq = [], spec = [];
for (const [s, b] of rules) {
  const m = b.match(/border-radius\s*:\s*([^;]+);?/);
  if (!m) continue;
  const v = m[1].trim();
  if (KEEP.has(s)) continue;
  if (SPECIAL[s]) { spec.push(`html[data-design="pro"] ${s} { border-radius:${SPECIAL[s]}; }`); continue; }
  if (v.includes("50%")) { sq.push(s); continue; }
  if (to4.has(v)) out4.push(s);
  else if (to6.has(v)) out6.push(s);
}
// Grouped selectors (a, b, c) must have EVERY part prefixed, or the
// parts after commas escape the scope and leak into Alternate mode.
const scope = (s) => s.split(",").map(p => `html[data-design="pro"] ${p.trim()}`).join(",\n");
const pre = (arr) => arr.map(scope).join(",\n");
let gen = "/* ---- GENERATED GEOMETRY LAYER — from tools/gen_pro_geometry.js.\n";
gen += "   Radius scale: pills/inputs/buttons → 4px; cards/panels/menus → 6px;\n";
gen += "   circles (avatars, badges) → 6px squares. Regenerate after adding\n";
gen += "   new radii to app.css. ---- */\n\n";
gen += pre(out6) + " { border-radius:6px; }\n\n";
gen += pre(out4) + " { border-radius:4px; }\n\n";
gen += pre(sq) + " { border-radius:6px; }\n\n";
gen += spec.join("\n") + "\n";
fs.writeFileSync("/tmp/gen_layer.css", gen);
console.log(`6px: ${out6.length} | 4px: ${out4.length} | squared circles: ${sq.length} | special: ${spec.length}`);
