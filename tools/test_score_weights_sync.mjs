// test_score_weights_sync.mjs — the breakdown page's weights map must not
// drift from ScoreEngine.php.
//
// The breakdown page shows "16 of 32" per factor. Those denominators live
// in a JS map (SCORE_WEIGHTS in profile.js) keyed by ScoreEngine::VERSION,
// because stored breakdowns are frozen JSON and carry no maxima of their
// own. If someone bumps the weights or VERSION in PHP without updating the
// map, every user sees a denominator that is quietly wrong — the score
// still renders, nothing errors, and the number lies.
//
// That is exactly the silent-failure shape this repo has been bitten by
// before, so it gets a test rather than a comment.
//
// Run: node tools/test_score_weights_sync.mjs

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const php = readFileSync(join(root, "src/ScoreEngine.php"), "utf8");
const js = readFileSync(join(root, "assets/js/profile.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => {
  c ? (pass++, console.log("  ✓ " + n + (extra ? ` — ${extra}` : "")))
    : (fail++, console.log("  ✗ " + n + (extra ? ` — ${extra}` : "")));
};

// ---- parse the engine ---------------------------------------------------
const version = (php.match(/const VERSION\s*=\s*'([^']+)'/) || [])[1];
const W = Object.fromEntries(
  [...php.matchAll(/const (W_[A-Z_]+)\s*=\s*(\d+)/g)].map(m => [m[1], Number(m[2])])
);
// Factor keys the engine actually emits, in order.
const emitted = [...php.matchAll(/'factor' => '([a-z_]+)'/g)].map(m => m[1]);

// The engine emits education as ONE factor combining presence + relevance,
// so its max is the sum of both weights — not a single constant.
const expected = {
  relevant_experience: W.W_EXPERIENCE_RELEVANT,
  general_experience:  W.W_EXPERIENCE_GENERAL,
  skills_match:        W.W_SKILLS,
  education:           W.W_EDU_PRESENCE + W.W_EDU_RELEVANCE,
  certifications:      W.W_CERTS,
  profile_strength:    W.W_PROFILE_STRENGTH,
};

console.log("engine weights sum to 100 (the contract the UI relies on)");
ok(Object.values(W).reduce((a, b) => a + b, 0) === 100,
   "PHP weights sum to 100", String(Object.values(W).reduce((a, b) => a + b, 0)));

// ---- parse the JS map ---------------------------------------------------
const mapSrc = (js.match(/const SCORE_WEIGHTS = \{([\s\S]*?)\n\};/) || [])[1];
ok(!!mapSrc, "SCORE_WEIGHTS map found in profile.js");

console.log("JS map is in sync with the engine");
if (mapSrc) {
  const keyed = [...mapSrc.matchAll(/"([^"]+)":\s*\{([\s\S]*?)\}/g)];
  const versions = keyed.map(m => m[1]);
  ok(versions.includes(version),
     "map has an entry for the CURRENT ScoreEngine::VERSION",
     `${version} (map has: ${versions.join(", ")})`);

  const entry = keyed.find(m => m[1] === version);
  if (entry) {
    const got = Object.fromEntries(
      [...entry[2].matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])])
    );
    for (const [k, v] of Object.entries(expected)) {
      ok(got[k] === v, `max for "${k}" matches engine`, `expected ${v}, map has ${got[k]}`);
    }
    ok(Object.values(got).reduce((a, b) => a + b, 0) === 100,
       "map maxima sum to 100");
    // Every factor the engine emits must be representable, or a user sees
    // a row with no denominator on the current version.
    for (const k of new Set(emitted)) {
      ok(k in got, `engine factor "${k}" has a max in the map`);
    }
    // And nothing extra, which would signal a removed factor.
    for (const k of Object.keys(got)) {
      ok(new Set(emitted).has(k), `map key "${k}" is still emitted by the engine`);
    }
  }
}

console.log("the breakdown page tells the truth about itself");
ok(!/still in development/.test(js),
   "no 'algorithm still in development' placeholder note");
ok(/function scoringLimitationsHtml/.test(js),
   "scoring limitations are stated to the user");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
