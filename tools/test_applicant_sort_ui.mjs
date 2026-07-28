// Behavioral test for the applicant list's sort control (assets/js/company.js).
// Loads the real renderJobApplicants into jsdom with a mocked api(), asserts:
//  - the sort <select> renders all six options, active one selected
//  - changing the sort re-fetches with the new &sort= param
//  - the rank column uses the server's fixed score_rank (not list index),
//    with a fallback marker for unranked (scoreless) applicants.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!DOCTYPE html><body><div id="view"></div></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;
window.el = (h) => { const t = window.document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
window.esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
window.$ = (id) => window.document.getElementById(id);
window.renderCompanyDashboard = () => {};
window.openApplicantDetail = () => {};
window.timeAgo = () => "recently";

// Mocked api() records every URL it's called with, returns a fixed payload.
let apiCalls = [];
const payloadFor = (sort) => ({
  ok: true, data: { success: true, data: {
    job: { uuid: "job1", title: "Data Analyst", status: "open" },
    sort,
    counts: { submitted: 3, withdrawn: 1, expired: 0 },
    applicants: [
      { uuid: "a1", status: "submitted", status_label: "Submitted", applied_at: "2026-07-20",
        score_value: 80, score_rank: 1, has_resume: true,
        candidate: { uuid: "u1", username: "zoe", full_name: "Zoe Adams", avatar: null } },
      { uuid: "a2", status: "submitted", status_label: "Submitted", applied_at: "2026-07-25",
        score_value: 60, score_rank: 2, has_resume: false,
        candidate: { uuid: "u2", username: "alice", full_name: "Alice Brown", avatar: null } },
      { uuid: "a3", status: "submitted", status_label: "Submitted", applied_at: "2026-07-26",
        score_value: null, score_rank: null, has_resume: true,
        candidate: { uuid: "u3", username: "ben", full_name: "Ben Carter", avatar: null } },
    ],
  } },
});
window.api = async (url) => {
  apiCalls.push(url);
  const m = /sort=([a-z]+)/.exec(url);
  return payloadFor(m ? m[1] : "score");
};

// Load company.js. It's large and defines many functions that close over
// globals; we only need renderJobApplicants + its module state. Evaluate the
// whole file in window scope with the globals aliased in.
const src = readFileSync("assets/js/company.js", "utf8");
try {
  window.eval(`var $=window.$, el=window.el, esc=window.esc, api=window.api,
    renderCompanyDashboard=window.renderCompanyDashboard, openApplicantDetail=window.openApplicantDetail,
    timeAgo=window.timeAgo;
    ${src}
    ;window.renderJobApplicants = renderJobApplicants;`);
} catch (e) {
  console.log("  ✗ company.js failed to load:", e.message);
  console.log("\n0 passed, 1 failed"); process.exit(1);
}

ok(typeof window.renderJobApplicants === "function", "renderJobApplicants loaded");

// --- initial render (default sort=score) --------------------------------
apiCalls = [];
await window.renderJobApplicants("job1");

ok(apiCalls.length === 1, "one fetch on initial render");
ok(/for-job\.php/.test(apiCalls[0]) && /job_uuid=job1/.test(apiCalls[0]), "fetches for-job with the job uuid");
ok(/sort=score/.test(apiCalls[0]), "initial fetch defaults to sort=score");

const sel = window.document.getElementById("ja-sort-sel");
ok(!!sel, "a sort <select> is rendered");
ok(sel.querySelectorAll("option").length === 6, "six sort options offered");
const optVals = [...sel.querySelectorAll("option")].map(o => o.value);
ok(JSON.stringify(optVals) === JSON.stringify(["score","newest","oldest","name","resume","status"]),
   "the six options are score,newest,oldest,name,resume,status");
ok(sel.value === "score", "score is the selected option by default");

// rank column uses server score_rank, not list index
const rows = window.document.querySelectorAll(".ja-row");
ok(rows.length === 3, "three applicant rows render");
const rankTexts = [...window.document.querySelectorAll(".ja-rank")].map(r => r.textContent.trim());
ok(rankTexts[0] === "1" && rankTexts[1] === "2", "ranked applicants show their fixed score_rank");
ok(window.document.querySelector(".ja-rank.none"), "the scoreless applicant gets an unranked marker");
ok(rankTexts[2] === "·", "unranked applicant shows '·', not a fabricated position");

// --- change sort -> refetch with new param ------------------------------
apiCalls = [];
sel.value = "newest";
sel.dispatchEvent(new window.Event("change", { bubbles: true }));
await new Promise(r => setTimeout(r, 0));   // let the async handler run

ok(apiCalls.length === 1, "changing the sort triggers exactly one refetch");
ok(/sort=newest/.test(apiCalls[0]), "refetch carries the newly chosen sort");
const selAfter = window.document.getElementById("ja-sort-sel");
ok(selAfter && selAfter.value === "newest", "the control reflects the active sort after refetch");

// teeth: score_rank stays fixed even under a non-score sort — rank 1 is still
// present in the list (order changed, ranking did not).
const ranksAfter = [...window.document.querySelectorAll(".ja-rank")].map(r => r.textContent.trim());
ok(ranksAfter.includes("1") && ranksAfter.includes("2"), "fixed score ranks persist under a date sort");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
