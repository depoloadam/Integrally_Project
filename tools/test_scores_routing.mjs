// Lightweight source assertions for the scores routing changes.
import { readFileSync } from "fs";
let pass=0, fail=0;
const ok=(c,n)=>{c?(pass++,console.log("  ✓ "+n)):(fail++,console.log("  ✗ "+n));};

const profile = readFileSync("assets/js/profile.js","utf8");
const feed = readFileSync("assets/js/feed.js","utf8");

// Score detail/history pages go back to scores, not profile.
// Isolate the two score render fns and assert their back links.
const breakdown = profile.slice(profile.indexOf("function renderScoreBreakdown"), profile.indexOf("function renderScoreHistory"));
const history = profile.slice(profile.indexOf("function renderScoreHistory"), profile.indexOf("function renderScoreHistory")+3000);
ok(breakdown.includes("Back to scores") && !breakdown.includes("Back to profile"), "score breakdown back link -> scores");
ok(history.includes("Back to scores") && !history.includes("Back to profile"), "score history back link -> scores");
ok(/renderScoreBreakdown[\s\S]*?location\.hash='scores'/.test(profile), "breakdown routes to scores hash");

// Strength / ai-skillset / edit / job-search still go to profile (must NOT change).
const strength = profile.slice(profile.indexOf("function renderStrengthPage"), profile.indexOf("function renderStrengthPage")+2000);
ok(strength.includes("Back to profile"), "strength page still returns to profile (unchanged)");

// teeth: prove the matcher would notice a wrong target
ok(!breakdown.includes("Back to profile"), "no stale 'Back to profile' left in score breakdown");

// Feed 'Explore my scores' routes to the hub.
ok(/Explore my scores[\s\S]{0,200}?location\.hash = "scores"/.test(feed), "feed 'Explore my scores' -> scores hub");
ok(!/Explore my scores[\s\S]{0,120}?location\.hash = "profile"/.test(feed), "feed explore no longer routes to profile");

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
