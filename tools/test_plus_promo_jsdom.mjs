// Behavioral test for the feed rail Plus promo card (buildPlusPromo in
// feed.js) and its placement between the score slot and the discover cards.
//   - shown to free members, hidden from Plus members, absent for company
//     feeds and when the slot/ME is missing (slot removed, no gap)
//   - CTA fires the shared "coming soon" acknowledgement (payments unbuilt)
//   - card uses the rail design language (.railcard) + gold tokens
//   - CSS contract: the promo styles exist and are token-driven (dark-safe)

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const src = readFileSync("assets/js/feed.js", "utf8");
const css = readFileSync("assets/css/app.css", "utf8");

// Extract buildPlusPromo by brace-matching (it's a plain function decl).
function extractFn(src, name, kw = "function") {
  const start = src.indexOf(`${kw} ${name}(`);
  const braceOpen = src.indexOf("{", src.indexOf(")", start));
  let j = braceOpen, d = 0;
  do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0);
  return src.slice(start, j);
}

const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;
const el = (h) => { const t = window.document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };

let toasts = [];
const toast = (m) => toasts.push(m);

const promoSrc = extractFn(src, "buildPlusPromo");
const makePromo = (ME, CO) => new Function(
  "el", "toast", "ME", "CO", "location",
  promoSrc + "; return buildPlusPromo;"
)(el, toast, ME, CO, window.location);

const mkSlot = () => { const s = el(`<div class="rail-slot"></div>`); window.document.body.appendChild(s); return s; };

console.log("gating");
// free member -> card shown
let slot = mkSlot();
makePromo({ plan: "free", uuid: "u1" }, null)(slot);
let card = slot.querySelector(".pluscard");
ok(!!card, "free member: promo card is shown");
ok(slot.parentNode !== null, "free member: slot kept");

// Plus member -> no card, slot removed (nothing to upsell)
slot = mkSlot();
makePromo({ plan: "plus", uuid: "u2" }, null)(slot);
ok(!slot.querySelector(".pluscard"), "Plus member: no promo card");
ok(slot.parentNode === null, "Plus member: empty slot removed (no gap)");

// company feed (no ME) -> absent
slot = mkSlot();
makePromo(null, { uuid: "c1" })(slot);
ok(!slot.querySelector(".pluscard"), "company feed: no promo card");
ok(slot.parentNode === null, "company feed: slot removed");

// defensive: member with no plan field -> treated as non-Plus, shown
slot = mkSlot();
makePromo({ uuid: "u3" }, null)(slot);
ok(!!slot.querySelector(".pluscard"), "member without a plan field: shown (treated non-Plus)");

console.log("\ncard structure + CTA");
slot = mkSlot();
makePromo({ plan: "free", uuid: "u4" }, null)(slot);
card = slot.querySelector(".pluscard");
ok(card.classList.contains("railcard"), "promo uses the shared .railcard design language");
ok(!!card.querySelector(".pluscard-tag"), "has a PLUS+ tag");
ok(!!card.querySelector(".pluscard-head"), "has a headline");
ok(!!card.querySelector(".pluscard-sub"), "has a sub-line");
const cta = card.querySelector(".pluscard-cta");
ok(!!cta, "has a CTA button");
toasts = [];
cta.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(toasts.length === 1 && /coming soon/i.test(toasts[0]), "CTA fires the 'coming soon' acknowledgement");

console.log("\nplacement in renderFeed");
// The promo slot must be reserved AFTER the score slot and BEFORE the
// discover rail, so the card sits between them regardless of async timing.
const feedFn = src.slice(src.indexOf("buildScoreRail(scoreSlot)"), src.indexOf("buildDiscoverRail(rail)") + 25);
ok(/buildScoreRail\(scoreSlot\)[\s\S]*buildPlusPromo\(plusSlot\)[\s\S]*buildDiscoverRail\(rail\)/.test(feedFn),
   "promo is built after scores and before discover cards");
// teeth: the ordering assertion must reject the reverse.
ok(!/buildDiscoverRail\(rail\)[\s\S]*buildPlusPromo/.test(feedFn),
   "ordering check rejects promo-after-discover");

console.log("\nCSS contract (token-driven, dark-safe)");
ok(/\.pluscard\s*\{/.test(css), ".pluscard rule exists");
const block = css.slice(css.indexOf(".pluscard {"), css.indexOf(".pluscard-cta:focus-visible") + 120);
ok(/var\(--in-gold/.test(block), "promo styles are gold-token driven");
ok(!/#[0-9a-fA-F]{3,6}/.test(block.replace(/var\([^)]*\)/g, "")),
   "no raw hex outside tokens in the promo block (dark-mode safe)");
// teeth: a token that doesn't exist would fail the earlier definition check.
ok(css.includes("--in-gold:") && css.includes("--in-gold-ink:"),
   "gold tokens the card relies on are defined");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
