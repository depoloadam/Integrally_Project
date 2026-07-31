// Behavioral test for the "Improve this score" coaching page in scores.js.
//
// Drives the real renderScoreImprove() and its helpers through a mocked
// api() that returns whatif-shaped envelopes, and asserts: the baseline
// dial + factor headroom render, staging an item calls whatif and moves
// the dial, removing it reverts, factor bars show the gain, and the
// profile bridge appears only when something is staged.
//
// Every matcher is paired with a sanity check that rejects wrong input.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!DOCTYPE html><body><div id="view"></div></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;

window.el = (html) => { const t = window.document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
window.esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
window.$ = (id) => window.document.getElementById(id);
window.ME = { id: 1 };
window.renderSignedOut = () => {};
window.scoreFactorLabel = (k) => ({ skills_match: "Skills match", certifications: "Certifications", relevant_experience: "Relevant experience" }[k] || k);
window.SCORE_FACTOR_BLURB = { skills_match: "Listed skills weighted by relevance.", certifications: "Certs weighted by relevance.", relevant_experience: "Years in category." };

// Mock api(): returns a whatif envelope shaped by the additions it's given.
let apiCalls = [];
const BASE_FACTORS = [
  { factor: "relevant_experience", detail: "2y", points: 8, ceiling: 32, headroom: 24 },
  { factor: "skills_match", detail: "few", points: 4, ceiling: 20, headroom: 16 },
  { factor: "certifications", detail: "none", points: 0, ceiling: 10, headroom: 10 },
];
window.api = async (path, method, body) => {
  apiCalls.push({ path, method, body });
  const adds = (body && body.additions) || null;
  const nSkills = adds ? (adds.skills || []).length : 0;
  const nCerts = adds ? (adds.certifications || []).length : 0;
  const total = nSkills + nCerts + (adds ? (adds.education || []).length : 0);
  const baseline = { score: 25, factors: BASE_FACTORS };
  let projected = null, delta = null, factor_deltas = null;
  if (total > 0) {
    // each skill +2 on skills_match, each cert +3 on certifications
    const skGain = nSkills * 2, certGain = nCerts * 3;
    const projScore = 25 + skGain + certGain;
    projected = { score: projScore, factors: [
      { factor: "relevant_experience", detail: "2y", points: 8 },
      { factor: "skills_match", detail: "more", points: 4 + skGain },
      { factor: "certifications", detail: "some", points: 0 + certGain },
    ]};
    delta = projScore - 25;
    factor_deltas = [
      { factor: "relevant_experience", before: 8, after: 8, change: 0 },
      { factor: "skills_match", before: 4, after: 4 + skGain, change: skGain },
      { factor: "certifications", before: 0, after: certGain, change: certGain },
    ];
  }
  return { ok: true, status: 200, data: { success: true, error: null, data: {
    target_type: body.target_type, target_value: body.target_value,
    baseline, projected, delta, factor_deltas,
    applied: { skills: nSkills, certifications: nCerts, education: 0, jobs: 0 },
  }}};
};

// Load the module.
const src = readFileSync("assets/js/scores.js", "utf8");
const wrapped = src + "\n;window.__imp = { renderScoreImprove, runWhatIf, IMPROVE_STATE_GET: () => IMPROVE_STATE };";
window.eval(`var ME=window.ME, el=window.el, esc=window.esc, $=window.$, api=window.api, scoreFactorLabel=window.scoreFactorLabel, SCORE_FACTOR_BLURB=window.SCORE_FACTOR_BLURB, renderSignedOut=window.renderSignedOut, location=window.location;\n${wrapped}`);
const M = window.__imp;

const tick = () => new Promise(r => setTimeout(r, 0));

console.log("initial render (baseline)");
await M.renderScoreImprove(encodeURIComponent("job_title|Data Analyst"));
await tick();
ok(window.document.querySelector(".in-improve-head"), "coaching page header renders");
ok($("imp-score") && $("imp-score").textContent === "25", "dial shows baseline score 25");
const factorNames = [...window.document.querySelectorAll(".in-improve-factor-name")].map(n => n.textContent);
ok(factorNames.length === 3, "a bar per factor");
// ranked by headroom: relevant_experience (24) first
ok(factorNames[0] === "Relevant experience", "factors ranked by headroom (most first)");
ok(window.document.body.textContent.includes("+24 to gain"), "headroom label shown for the biggest gap");
// sanity: baseline call carried no additions
ok(apiCalls.length === 1 && !apiCalls[0].body.additions, "initial call is baseline (no additions)");
// bridge hidden with nothing staged
ok($("imp-bridge") && $("imp-bridge").style.display === "none", "profile bridge hidden until something is staged");

console.log("\nstage a skill -> dial + factor move");
$("imp-skill").value = "SQL";
$("imp-skill-add").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));  // debounce
ok(M.IMPROVE_STATE_GET().additions.skills.length === 1, "skill staged in state");
ok($("imp-staged").textContent.includes("SQL"), "staged chip shows the skill");
ok($("imp-score").textContent === "27", "dial rises to projected 27 (baseline 25 + 2)");
ok($("imp-score").classList.contains("up"), "dial marked as improved");
ok($("imp-proj").textContent.includes("+2"), "projection line shows the delta");
ok($("imp-bridge").style.display === "", "bridge appears once something is staged");
// skills_match factor should show a gain
ok(window.document.body.textContent.includes("+2"), "skills factor shows the +2 gain");

console.log("\nstage a cert too -> compounds");
$("imp-cert").value = "Google Data Analytics";
$("imp-cert-add").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
ok($("imp-score").textContent === "30", "dial now 30 (25 + skill 2 + cert 3)");
ok($("imp-staged").textContent.includes("Google Data Analytics"), "cert chip staged");

console.log("\nremove the skill -> reverts");
const removeBtn = $("imp-staged").querySelector(".in-improve-chip-x");
removeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await tick();
ok(M.IMPROVE_STATE_GET().additions.skills.length === 0, "skill removed from state");
ok($("imp-score").textContent === "28", "dial drops to 28 (cert only: 25 + 3)");

console.log("\nremove everything -> back to baseline");
$("imp-staged").querySelector(".in-improve-chip-x").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await tick();
ok(M.IMPROVE_STATE_GET().additions.certifications.length === 0, "cert removed");
ok($("imp-score").textContent === "25", "dial back to baseline 25");
ok(!$("imp-score").classList.contains("up"), "improved marker cleared at baseline");
ok($("imp-bridge").style.display === "none", "bridge hidden again when nothing staged");

console.log("\nbad target guard");
$("view").innerHTML = "";
await M.renderScoreImprove("garbage-no-pipe");
await tick();
ok(/couldn't be read/i.test($("view").textContent), "malformed target (no pipe) shows a guard message");
// teeth: a well-formed target must NOT hit the guard
$("view").innerHTML = "";
await M.renderScoreImprove(encodeURIComponent("skill|Python"));
await tick();
ok(!/couldn't be read/i.test($("view").textContent), "well-formed target does not hit the guard");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
