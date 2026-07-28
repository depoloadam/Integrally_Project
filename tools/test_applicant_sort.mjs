// Logic-parity test for the applicant sort comparators in
// api/applications/for-job.php. PHP can't run in this sandbox, so the
// comparators (fixed score_rank + the six display sorts) are re-implemented
// here 1:1 and checked against fixtures. This verifies the ORDERING RULES;
// the SQL fetch itself is unchanged from origin's known-good query.
//
// If the PHP logic changes, this must change in lockstep — it's a parity
// mirror, not an integration test.

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

// --- mirror of the PHP: assign fixed score_rank in score-first order -----
// PHP fetches ORDER BY (score IS NULL), score DESC, created_at ASC, uuid ASC
// then assigns ++rank only to scored rows.
function withScoreRank(rows) {
  const fetched = rows.slice().sort((a, b) => {
    const an = a.score_value == null, bn = b.score_value == null;
    if (an !== bn) return an ? 1 : -1;                 // nulls last
    if (!an && a.score_value !== b.score_value) return b.score_value - a.score_value; // score desc
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;   // created asc
    return a.uuid < b.uuid ? -1 : (a.uuid > b.uuid ? 1 : 0);                          // uuid asc
  });
  let rank = 0;
  for (const r of fetched) r.score_rank = r.score_value != null ? ++rank : null;
  return fetched;
}

const byScoreRank = (a, b) => {
  if (a.score_rank === null && b.score_rank === null) return a.uuid < b.uuid ? -1 : (a.uuid > b.uuid ? 1 : 0);
  if (a.score_rank === null) return 1;
  if (b.score_rank === null) return -1;
  return a.score_rank - b.score_rank;
};
const nameKey = (a) => (a.candidate.full_name ?? a.candidate.username ?? "").trim().toLowerCase();
const statusOrder = { submitted: 0, withdrawn: 1, expired: 2, job_unavailable: 3 };

function applySort(rows, sort) {
  const a2 = rows.slice();
  a2.sort((a, b) => {
    let c;
    switch (sort) {
      case "newest": c = (a.applied_at < b.applied_at ? 1 : a.applied_at > b.applied_at ? -1 : 0); return c || byScoreRank(a, b);
      case "oldest": c = (a.applied_at < b.applied_at ? -1 : a.applied_at > b.applied_at ? 1 : 0); return c || byScoreRank(a, b);
      case "name":   c = (nameKey(a) < nameKey(b) ? -1 : nameKey(a) > nameKey(b) ? 1 : 0); return c || byScoreRank(a, b);
      case "resume": c = (b.has_resume ? 1 : 0) - (a.has_resume ? 1 : 0); return c || byScoreRank(a, b);
      case "status": c = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9); return c || byScoreRank(a, b);
      default:       return byScoreRank(a, b);
    }
  });
  return a2;
}

// --- fixture ------------------------------------------------------------
const mk = (uuid, score, applied, status, resume, name) => ({
  uuid, score_value: score, applied_at: applied, created_at: applied, status,
  has_resume: resume, candidate: { full_name: name, username: name ? name.toLowerCase().replace(" ", "") : "u" + uuid },
});
let rows = [
  mk("a", 80, "2026-07-20", "submitted", true,  "Zoe Adams"),
  mk("b", 60, "2026-07-25", "submitted", false, "Alice Brown"),
  mk("c", 80, "2026-07-18", "withdrawn", true,  "Mona Lee"),   // ties 80 with a; earlier date -> ranks above a
  mk("d", null, "2026-07-26", "submitted", true, "Ben Carter"),// scoreless
  mk("e", 45, "2026-07-22", "expired",   false, "Cara Diaz"),
];
rows = withScoreRank(rows);

console.log("fixed score_rank (score-first, ties by date then uuid)");
const rankOf = (u) => rows.find(r => r.uuid === u).score_rank;
ok(rankOf("c") === 1, "c (80, earlier date) is score rank 1");
ok(rankOf("a") === 2, "a (80, later date) is score rank 2");
ok(rankOf("b") === 3, "b (60) is rank 3");
ok(rankOf("e") === 4, "e (45) is rank 4");
ok(rankOf("d") === null, "d (no score) is unranked");

console.log("\nsort: score (default) — rank order, scoreless last");
let s = applySort(rows, "score").map(r => r.uuid);
ok(JSON.stringify(s) === JSON.stringify(["c","a","b","e","d"]), "score order c,a,b,e,d");
ok(s[s.length - 1] === "d", "scoreless applicant sinks to the bottom");

console.log("\nsort: newest / oldest");
ok(applySort(rows, "newest")[0].uuid === "d", "newest first = d (2026-07-26)");
ok(applySort(rows, "oldest")[0].uuid === "c", "oldest first = c (2026-07-18)");
// teeth: newest and oldest are genuine reverses at the ends
const nw = applySort(rows, "newest").map(r => r.uuid);
const od = applySort(rows, "oldest").map(r => r.uuid);
ok(nw[0] === od[od.length - 1], "newest[0] equals oldest[last]");

console.log("\nsort: name (A–Z, case-insensitive)");
const nm = applySort(rows, "name").map(r => r.candidate.full_name);
ok(nm[0] === "Alice Brown", "name sort starts at Alice Brown");
ok(nm[nm.length - 1] === "Zoe Adams", "name sort ends at Zoe Adams");

console.log("\nsort: resume (has-resume first, tie by score rank)");
const rz = applySort(rows, "resume");
ok(rz.slice(0, 3).every(r => r.has_resume), "first three all have resumes");
ok(!rz[rz.length - 1].has_resume || !rz[rz.length - 2].has_resume, "resumeless applicants trail");
// within has-resume group, order is score rank: c(1), a(2), d(unranked last of group)
const resWithResume = rz.filter(r => r.has_resume).map(r => r.uuid);
ok(JSON.stringify(resWithResume) === JSON.stringify(["c","a","d"]), "within resume group, score rank drives order (c,a,d)");

console.log("\nsort: status (active first)");
const st = applySort(rows, "status").map(r => r.status);
ok(st[0] === "submitted", "submitted (active) applicants first");
ok(st.indexOf("expired") > st.lastIndexOf("submitted"), "expired sorts after all submitted");
ok(st.indexOf("withdrawn") < st.indexOf("expired"), "withdrawn before expired");

console.log("\nteeth: whitelist — unknown sort falls back to score");
ok(JSON.stringify(applySort(rows, "bogus").map(r => r.uuid)) === JSON.stringify(["c","a","b","e","d"]),
   "unknown sort behaves as score");

console.log("\nteeth: every sort keeps the same set of applicants (no drops/dupes)");
for (const srt of ["score","newest","oldest","name","resume","status"]) {
  const ids = applySort(rows, srt).map(r => r.uuid).sort().join("");
  ok(ids === "abcde", `${srt} preserves all 5 applicants exactly once`);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
