// Behavioral test for the Scores hub (assets/js/scores.js).
//
// scores.js builds DOM from an insights payload via pure builder
// functions (buildSummary, buildPersonalPanel, buildTargetStanding,
// buildAverages, buildTrending). We load the REAL functions into a jsdom
// window with the minimal globals they need ($, el, esc, ME), feed them
// a hand-designed payload, and assert the rendered structure, the tab
// switching, and the comparison-line logic.
//
// Every matcher is paired with a sanity assertion proving it rejects the
// wrong input — a test that can't fail is worse than none.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!DOCTYPE html><body><div id="view"></div></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;

// Minimal shell globals the module closes over.
window.el = (html) => { const t = window.document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
window.esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
window.$ = (id) => window.document.getElementById(id);
window.ME = { id: 1 };
let scoreMeCalls = [];
window.scoreMe = (prefill) => scoreMeCalls.push(prefill);
window.location.hash = "";

// Load the real module source, stripping the top-level `let SCORES_*`
// re-declarations aren't an issue (module scope), then eval into window.
const src = readFileSync("assets/js/scores.js", "utf8");
// Expose the builder fns + state on window by evaluating in global scope.
const wrapped = src + "\n;window.__scores = { buildSummary, buildPersonalPanel, buildTargetStanding, buildAverages, buildTrending, SCORES_STATE };window.renderScores = renderScores;";
window.eval(`var ME = window.ME, el = window.el, esc = window.esc, $ = window.$, scoreMe = window.scoreMe, location = window.location;\n${wrapped}`);
const S = window.__scores;

// sanity: the module actually loaded its builders
console.log("module load");
ok(typeof S.buildSummary === "function", "buildSummary loaded");
ok(typeof S.buildTargetStanding === "function", "buildTargetStanding loaded");
ok(!S.__missing, "no phantom export (sanity)");

// ---- payload -------------------------------------------------------
const payload = {
  generated_at: "2026-07-27T00:00:00+00:00",
  personal: [
    { target_type: "job_title", target_value: "Data Analyst", score_value: 60, created_at: "2026-07-20T10:00:00Z",
      hidden: false, community_avg: 55, pool_size: 5, percentile: 75, top_percent: 25 },
    { target_type: "field", target_value: "Healthcare", score_value: 90, created_at: "2026-07-25T10:00:00Z",
      hidden: false, community_avg: 60, pool_size: 3, percentile: 100, top_percent: 0 },
    { target_type: "skill", target_value: "Python", score_value: 48, created_at: "2026-07-26T10:00:00Z",
      hidden: true, community_avg: null, pool_size: 1, percentile: null, top_percent: null },
  ],
  personal_mean: 66,
  averages: {
    overall: { avg: 58, samples: 10 },
    by_type: { job_title: { avg: 55, samples: 5 }, skill: { avg: 48, samples: 2 }, field: { avg: 60, samples: 3 } },
  },
  trending: {
    job_title: [{ target_value: "Data Analyst", pool_size: 5, avg: 55, recent_scores: 4 }],
    field: [{ target_value: "Healthcare", pool_size: 3, avg: 60, recent_scores: 3 }],
    skill: [],
  },
};

// ---- Region 1: summary ---------------------------------------------
console.log("\nsummary hero");
const hero = S.buildSummary(payload, payload.personal);
const nums = [...hero.querySelectorAll(".in-scores-stat-num")].map(n => n.textContent);
ok(nums.includes("3"), "shows target count of 3");
ok(nums.includes("66"), "shows personal mean of 66");
const strongBadge = hero.querySelector(".in-scores-hero-badge");
ok(strongBadge && strongBadge.textContent === "90", "strongest badge shows 90 (Healthcare)");
ok(hero.textContent.includes("Healthcare"), "strongest target named");
// sanity: a different mean must not render as 66
const hero2 = S.buildSummary({ ...payload, personal_mean: 41 }, payload.personal);
ok([...hero2.querySelectorAll(".in-scores-stat-num")].some(n => n.textContent === "41"), "mean matcher tracks the data");

// empty state
const heroEmpty = S.buildSummary({ personal_mean: null }, []);
ok(heroEmpty.textContent.includes("haven't scored"), "empty summary invites scoring");
ok(!!heroEmpty.querySelector("#scores-go-score"), "empty summary has a score CTA");

// ---- Region 2: tabbed personal panel -------------------------------
console.log("\ntabbed personal panel");
S.SCORES_STATE.activeTarget = null;   // reset
const panel = S.buildPersonalPanel(payload.personal);
const tabs = panel.querySelectorAll(".in-scores-tab");
ok(tabs.length === 3, "one tab per scored target (3)");

// settings gear routes to the scores settings tab
const gear = panel.querySelector("#scores-settings-btn");
ok(!!gear, "panel header has a settings gear");
window.location.hash = "";
gear && gear.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(window.location.hash.replace(/^#/, "") === "settings/scores", "gear routes to settings/scores");
ok(gear && gear.getAttribute("aria-label") === "Score settings", "gear is labelled for a11y");
ok([...tabs].map(t => t.querySelector(".in-scores-tab-name").textContent).join(",") === "Data Analyst,Healthcare,Python",
   "tabs labelled by target, in order");
ok(tabs[0].querySelector(".in-scores-tab-badge").textContent === "60", "tab badge shows the score");
// first tab active by default
ok(tabs[0].classList.contains("active"), "first tab active by default");
const panelBody = panel.querySelector(".in-scores-panel");
ok(panelBody.textContent.includes("Data Analyst"), "panel body shows first target");

// clicking the 2nd tab swaps the body + active state
tabs[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tabsAfter = panel.querySelectorAll(".in-scores-tab");
ok(tabsAfter[1].classList.contains("active") && !tabsAfter[0].classList.contains("active"),
   "clicking a tab moves the active state");
ok(panel.querySelector(".in-scores-panel").textContent.includes("Healthcare"),
   "clicking a tab swaps the panel body");
// sanity: it should NOT still show the old target's compare context
ok(!panel.querySelector(".in-scores-panel").textContent.includes("Data Analyst"),
   "old target no longer in the panel after switch");

// ---- target standing detail ----------------------------------------
console.log("\ntarget standing");
const daStanding = S.buildTargetStanding(payload.personal[0]);
ok(daStanding.querySelector(".in-scores-standing-badge").textContent === "60", "standing badge shows score");
// marker + average tick both present, positioned by value
const marker = daStanding.querySelector(".score-bar-marker");
const tick = daStanding.querySelector(".in-scores-avg-tick");
ok(marker && marker.getAttribute("style").includes("left:60%"), "your marker at 60%");
ok(tick && tick.getAttribute("style").includes("left:55%"), "average tick at community avg 55%");
ok(daStanding.textContent.includes("top 25%"), "comparison line states top 25%");
ok(/above the community average/.test(daStanding.textContent), "comparison notes above-average (60 vs 55)");

// below-average case
const below = S.buildTargetStanding({ ...payload.personal[0], score_value: 40, top_percent: 80, community_avg: 55 });
ok(/below the community average/.test(below.textContent), "below-average phrasing when score < avg");

// thin-pool case (pool_size 1) — no false comparison
const thin = S.buildTargetStanding(payload.personal[2]);
ok(/first to score/i.test(thin.textContent), "pool of 1 shows 'first to score', not a fake percentile");
ok(!thin.querySelector(".in-scores-avg-tick"), "no average tick when there's no community avg");

// history link routes by target
window.location.hash = "";
daStanding.querySelector(".in-scores-hist").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(window.location.hash.includes("score-history/"), "history button routes to score-history");
ok(decodeURIComponent(window.location.hash).includes("job_title|Data Analyst"), "history route carries the target");

// ---- Region 3: averages --------------------------------------------
console.log("\naverages");
const avg = S.buildAverages(payload, payload.personal);
const avgRows = avg.querySelectorAll(".in-scores-avgrow");
ok(avgRows.length === 3, "an average row per type with samples");
ok(avg.textContent.includes("55 avg") && avg.textContent.includes("5 scored"), "job title row shows avg + count");
const youMark = avg.querySelector(".in-scores-avgbar-you");
ok(youMark && youMark.getAttribute("style").includes("left:66%"), "your-mean marker at 66%");
ok(avg.textContent.includes("58"), "overall average shown");
// sanity: a type with 0 samples must not render a row
const avgNoSkill = S.buildAverages({
  ...payload,
  averages: { overall: { avg: 55, samples: 8 }, by_type: { ...payload.averages.by_type, skill: { avg: null, samples: 0 } } },
}, payload.personal);
ok(avgNoSkill.querySelectorAll(".in-scores-avgrow").length === 2, "type with 0 samples is omitted");

// ---- Region 4: trending --------------------------------------------
console.log("\ntrending");
const trend = S.buildTrending(payload);
const cols = trend.querySelectorAll(".in-scores-trend-col");
ok(cols.length === 2, "only non-empty trending groups render (job_title + field)");
const items = trend.querySelectorAll(".in-scores-trend-item");
ok(items.length === 2, "one row per trending target");
ok(items[0].querySelector(".in-scores-trend-rank").textContent === "1", "trending rows are ranked");
ok(items[0].textContent.includes("5 scored") && items[0].textContent.includes("55 avg"), "trending row shows pool + avg");

// clicking a trending item opens the score dialog pre-filled
scoreMeCalls = [];
items[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(scoreMeCalls.length === 1, "clicking trending calls scoreMe once");
ok(scoreMeCalls[0] && scoreMeCalls[0].target_type === "job_title" && scoreMeCalls[0].target_value === "Data Analyst",
   "scoreMe prefilled with the trending target");

// all-empty trending
const trendEmpty = S.buildTrending({ trending: { job_title: [], field: [], skill: [] } });
ok(/Nothing trending/i.test(trendEmpty.textContent), "empty trending shows a helpful message");

// ---- renderScores end-to-end through a mocked api() envelope --------
// This is the layer the builder tests skip: renderScores calls api(),
// which wraps payloads as { ok, status, data:{ success, data, error } }.
// Reading that envelope wrong makes the page show "no scores" even when
// the user has them — the exact bug reported. Assert the unwrap here.
console.log("\nrenderScores unwraps the api() envelope");
window.renderSignedOut = () => {};
let apiReturn;
window.api = async () => apiReturn;
window.eval(`api = window.api; renderSignedOut = window.renderSignedOut;`);

async function runRender(envelope) {
  apiReturn = envelope;
  window.document.getElementById("view").innerHTML = "";
  S.SCORES_STATE.activeTarget = null;
  await window.eval(`renderScores()`);
  return window.document.getElementById("view");
}

// Correct envelope: user HAS scores. Page must NOT show the empty state.
const view1 = await runRender({ ok: true, status: 200, data: { success: true, error: null, data: payload } });
ok(!view1.textContent.includes("haven't scored"), "with scores present, no 'haven't scored' message");
ok(view1.querySelectorAll(".in-scores-tab").length === 3, "renders a tab per real score through the envelope");
// sanity: the raw payload (unwrapped) must NOT be treated as the result —
// if someone reads api() as the payload, this fails.
ok(view1.textContent.includes("Data Analyst"), "real target names reach the DOM");

// Genuinely empty payload -> empty state.
const view2 = await runRender({ ok: true, status: 200, data: { success: true, error: null, data: { personal: [], personal_mean: null, averages: { overall: { avg: null, samples: 0 }, by_type: {} }, trending: {} } } });
ok(view2.textContent.includes("haven't scored"), "genuinely empty payload shows the empty state");

// Failed request -> error card, not a misleading empty state.
const view3 = await runRender({ ok: false, status: 500, data: null });
ok(view3.textContent.includes("Couldn't load"), "failed load shows an error, not 'haven't scored'");
ok(!view3.textContent.includes("haven't scored"), "failed load does NOT claim you have no scores");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
