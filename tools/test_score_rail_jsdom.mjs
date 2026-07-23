// test_score_rail_jsdom.mjs — the feed's "Your scores" rail card.
//
// Covers the real buildScoreRail from feed.js:
//   - ranks targets high-to-low, caps the list, and offers "see all"
//   - renders a clamped bar width per score and rounds the value
//   - marks hidden scores instead of dropping them (owner's own feed)
//   - empty state offers the setup CTA
//   - a failed/!ok API call renders NO card (feed never shows a broken one)
//   - target text goes in via textContent (no HTML injection)
//   - rows link to the app's real #score-history/<encoded "type|value">
//
// Run: node tools/test_score_rail_jsdom.mjs   (needs jsdom)

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const feedSrc = readFileSync(join(root, "assets/js/feed.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

function extractFn(src, name, kw = "async function") {
  const start = src.indexOf(`${kw} ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const parenOpen = src.indexOf("(", start);
  let i = parenOpen, d = 0;
  do { if (src[i] === "(") d++; else if (src[i] === ")") d--; i++; } while (d > 0);
  const braceOpen = src.indexOf("{", i);
  let j = braceOpen; d = 0;
  do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0);
  return src.slice(start, j);
}

const fnSrc = extractFn(feedSrc, "buildScoreRail");
// The limit constant lives beside the function.
const limitMatch = feedSrc.match(/const SCORE_RAIL_LIMIT = (\d+);/);
const LIMIT = limitMatch ? parseInt(limitMatch[1], 10) : 5;

function build(scores, opts = {}) {
  const dom = new JSDOM(`<!doctype html><body><aside id="rail"></aside></body>`, { url: "http://localhost/" });
  const { window } = dom;
  const document = window.document;
  const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const api = async () => opts.failCall
    ? Promise.reject(new Error("network"))
    : { ok: opts.notOk ? false : true, data: { data: scores } };
  const ME = { username: "adam", uuid: "u-1" };
  const fn = new Function("document", "el", "esc", "api", "ME", "location", "SCORE_RAIL_LIMIT",
    fnSrc + "; return buildScoreRail;")(document, el, esc, api, ME, window.location, LIMIT);
  return { window, document, mount: document.getElementById("rail"), fn };
}

const mk = (target, value, hidden = false, type = "job_title") =>
  ({ target_type: type, target_value: target, score_value: value, hidden });

console.log(`ranking + cap (SCORE_RAIL_LIMIT = ${LIMIT})`);
{
  const scores = [
    mk("Software Engineer", 71.4), mk("Data Analyst", 88.6), mk("Product Manager", 55),
    mk("Designer", 62), mk("QA Engineer", 43), mk("Recruiter", 91.2),
  ];
  const { mount, fn } = build(scores);
  await fn(mount);
  const card = mount.querySelector(".scorecard");
  ok(!!card, "card renders when scores exist");
  const rows = [...card.querySelectorAll(".score-rail-row")];
  ok(rows.length === LIMIT, `list capped at ${LIMIT} rows (got ${rows.length})`);
  const targets = rows.map(r => r.querySelector(".score-rail-target").textContent);
  ok(targets[0] === "Recruiter", `highest score leads (got "${targets[0]}")`);
  const vals = rows.map(r => parseInt(r.querySelector(".score-rail-val").textContent, 10));
  ok(vals.join(",") === [...vals].sort((a, b) => b - a).join(","), `values descend (${vals.join(" > ")})`);
  ok(vals[0] === 91, "score value is rounded (91.2 → 91)");
  const more = card.querySelector(".rail-more");
  ok(more && /all 6 scores/.test(more.textContent), `"see all" shows the true total (${more?.textContent.trim()})`);
}

console.log("\nbar widths");
{
  const { mount, fn } = build([mk("A", 73.6), mk("B", 0), mk("C", 140), mk("D", -5)]);
  await fn(mount);
  const bars = [...mount.querySelectorAll(".score-rail-bar > i")].map(b => b.style.width);
  ok(bars[0] === "100%", "over-100 score clamps to 100% (defensive)");
  ok(bars.includes("74%"), "73.6 → 74% bar width");
  ok(bars.includes("0%"), "0 and negative scores clamp to 0%");
}

console.log("\nhidden scores");
{
  const { mount, fn } = build([mk("Visible Role", 80), mk("Secret Role", 60, true)]);
  await fn(mount);
  const rows = [...mount.querySelectorAll(".score-rail-row")];
  ok(rows.length === 2, "hidden scores are shown on the owner's own feed, not dropped");
  const hiddenRow = rows.find(r => r.classList.contains("is-hidden-score"));
  ok(!!hiddenRow, "hidden score row carries the is-hidden-score class");
  ok(!!hiddenRow.querySelector(".score-rail-tag"), "hidden score row is tagged");
  ok(!rows[0].classList.contains("is-hidden-score"), "visible score row is not tagged");
}

console.log("\nempty + failure states");
{
  const { mount, fn } = build([]);
  await fn(mount);
  ok(!!mount.querySelector(".score-rail-empty"), "no scores → empty state");
  ok(!!mount.querySelector(".score-rail-cta"), "empty state offers a setup CTA");
  ok(!mount.querySelector(".score-rail-row"), "empty state renders no score rows");
}
{
  const { mount, fn } = build([], { notOk: true });
  await fn(mount);
  ok(mount.children.length === 0, "API !ok → no card at all (feed unaffected)");
}
{
  const { mount, fn } = build([], { failCall: true });
  await fn(mount);
  ok(mount.children.length === 0, "thrown API error → no card, no crash");
}

console.log("\nsafety + routing");
{
  const { mount, fn } = build([mk("<img src=x onerror=alert(1)>", 50)]);
  await fn(mount);
  const t = mount.querySelector(".score-rail-target");
  ok(t.querySelector("img") === null, "target text is not parsed as HTML");
  ok(t.textContent.includes("<img"), "raw target text preserved via textContent");
}
{
  const { window, mount, fn } = build([mk("Software Engineer", 70)]);
  await fn(mount);
  mount.querySelector(".score-rail-row").onclick();
  const expected = "score-history/" + encodeURIComponent("job_title|Software Engineer");
  ok(window.location.hash === "#" + expected,
     `row links to the real score-history route (${window.location.hash})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
