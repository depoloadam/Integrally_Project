<?php

// =====================================================================
// FILE: api/score/whatif.php
// POST (logged in) {
//   target_type: 'job_title'|'skill'|'field',
//   target_value: string,
//   additions: {
//     skills:        [ { name, proficiency? } ],
//     certifications:[ { name, issuer? } ],
//     education:     [ { institution?, degree?, field } ],
//     jobs:          [ { title, company_name?, start_date, end_date? } ]
//   }
// }
//
// Powers the "Improve this score" coach. This is the WHAT-IF engine: it
// takes the user's REAL gathered profile, merges in the hypothetical
// additions the user is considering, re-runs the SAME ScoreEngine, and
// returns the projected score with per-factor deltas. It never stores
// anything — recompute-only, so it's side-effect free and safe to call
// on every keystroke.
//
// Because it reuses ScoreEngine::compute() rather than re-implementing
// the maths, the projected number is exactly what a real re-score would
// produce if the user actually added these items. No estimation.
//
// It also returns per-factor HEADROOM (weight ceiling minus current
// points) computed from the baseline, so the UI can point the user at
// the factors with the most unrealized points even before they stage
// anything.
//
// Response:
//   {
//     target_type, target_value,
//     baseline: { score, factors: [ {factor, detail, points, ceiling, headroom} ] },
//     projected: { score, factors: [ {factor, detail, points} ] } | null,
//     delta: float|null,                       // projected.score - baseline.score
//     factor_deltas: [ {factor, before, after, change} ] | null,
//     applied: { skills:int, certifications:int, education:int, jobs:int }
//   }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/ScoreEngine.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$targetType  = trim($in['target_type'] ?? '');
$targetValue = trim($in['target_value'] ?? '');
$validTypes  = ['job_title', 'skill', 'field'];

if (!in_array($targetType, $validTypes, true)) {
    Response::error("target_type must be one of: " . implode(', ', $validTypes) . '.', 422);
}
if ($targetValue === '' || strlen($targetValue) > 150) {
    Response::error('target_value is required (150 chars max).', 422);
}

// Per-factor weight ceilings, mirrored from ScoreEngine's constants so the
// UI can show "8 of 20". These are the tunable weights; kept in sync with
// src/ScoreEngine.php. The keys match the 'factor' strings compute() emits.
$CEILINGS = [
    'relevant_experience' => ScoreEngine::W_EXPERIENCE_RELEVANT,
    'general_experience'  => ScoreEngine::W_EXPERIENCE_GENERAL,
    'skills_match'        => ScoreEngine::W_SKILLS,
    'education'           => ScoreEngine::W_EDU_PRESENCE + ScoreEngine::W_EDU_RELEVANCE,
    'certifications'      => ScoreEngine::W_CERTS,
];

// ---------------------------------------------------------------------
// Baseline: the user's real profile, scored as-is.
// ---------------------------------------------------------------------
$profile  = ScoreEngine::gatherProfile($pdo, $userId);
$baseline = ScoreEngine::compute($profile, $targetType, $targetValue);

$baseFactors = [];
foreach ($baseline['breakdown'] as $f) {
    $ceiling = $CEILINGS[$f['factor']] ?? null;
    $headroom = $ceiling !== null ? round(max(0, $ceiling - (float) $f['points']), 1) : null;
    $baseFactors[] = [
        'factor'   => $f['factor'],
        'detail'   => $f['detail'],
        'points'   => (float) $f['points'],
        'ceiling'  => $ceiling,
        'headroom' => $headroom,
    ];
}

// ---------------------------------------------------------------------
// Staged additions. Validate + normalise each into the exact row shape
// gatherProfile() returns, so compute() reads them identically to real
// data. Anything malformed is skipped rather than erroring the whole
// request — the coach is interactive and should be forgiving.
// ---------------------------------------------------------------------
$additions = is_array($in['additions'] ?? null) ? $in['additions'] : [];
$applied = ['skills' => 0, 'certifications' => 0, 'education' => 0, 'jobs' => 0];

// Caps so a crafted request can't stage thousands of items into compute().
const WHATIF_MAX_PER_TYPE = 25;

$str = static function ($v, int $max): ?string {
    if (!is_string($v)) return null;
    $v = trim($v);
    if ($v === '' || strlen($v) > $max) return null;
    return $v;
};

// Skills: { name, proficiency? (1-5, default 3) }
if (is_array($additions['skills'] ?? null)) {
    foreach ($additions['skills'] as $s) {
        if ($applied['skills'] >= WHATIF_MAX_PER_TYPE) break;
        $name = $str($s['name'] ?? null, 100);
        if ($name === null) continue;
        $prof = (int) ($s['proficiency'] ?? 3);
        if ($prof < 1 || $prof > 5) $prof = 3;
        $profile['skills'][] = ['name' => $name, 'proficiency' => $prof];
        $applied['skills']++;
    }
}

// Certifications: { name, issuer? }
if (is_array($additions['certifications'] ?? null)) {
    foreach ($additions['certifications'] as $c) {
        if ($applied['certifications'] >= WHATIF_MAX_PER_TYPE) break;
        $name = $str($c['name'] ?? null, 150);
        if ($name === null) continue;
        $profile['certifications'][] = [
            'name'   => $name,
            'issuer' => $str($c['issuer'] ?? null, 150) ?? '',
        ];
        $applied['certifications']++;
    }
}

// Education: { institution?, degree?, field } — field is what feeds the
// relevance sub-factor, so it's the meaningful one.
if (is_array($additions['education'] ?? null)) {
    foreach ($additions['education'] as $e) {
        if ($applied['education'] >= WHATIF_MAX_PER_TYPE) break;
        $field = $str($e['field'] ?? null, 150);
        $degree = $str($e['degree'] ?? null, 150);
        // Need at least a field or a degree to be meaningful.
        if ($field === null && $degree === null) continue;
        $profile['education'][] = [
            'institution' => $str($e['institution'] ?? null, 150) ?? '',
            'degree'      => $degree ?? '',
            'field'       => $field ?? '',
        ];
        $applied['education']++;
    }
}

// Jobs: { title, company_name?, start_date, end_date? }. Dates drive the
// experience factors, so both title and start_date are required for a job
// to count.
if (is_array($additions['jobs'] ?? null)) {
    foreach ($additions['jobs'] as $j) {
        if ($applied['jobs'] >= WHATIF_MAX_PER_TYPE) break;
        $title = $str($j['title'] ?? null, 150);
        $start = $str($j['start_date'] ?? null, 20);
        if ($title === null || $start === null) continue;
        $profile['jobs'][] = [
            'title'        => $title,
            'company_name' => $str($j['company_name'] ?? null, 150) ?? '',
            'start_date'   => $start,
            'end_date'     => $str($j['end_date'] ?? null, 20),  // null = current
        ];
        $applied['jobs']++;
    }
}

$totalApplied = array_sum($applied);

// ---------------------------------------------------------------------
// Projected: recompute with the merged profile (only if anything staged).
// ---------------------------------------------------------------------
$projected = null;
$delta = null;
$factorDeltas = null;

if ($totalApplied > 0) {
    $proj = ScoreEngine::compute($profile, $targetType, $targetValue);
    $projFactors = [];
    foreach ($proj['breakdown'] as $f) {
        $projFactors[] = [
            'factor' => $f['factor'],
            'detail' => $f['detail'],
            'points' => (float) $f['points'],
        ];
    }
    $projected = ['score' => (float) $proj['score'], 'factors' => $projFactors];
    $delta = round((float) $proj['score'] - (float) $baseline['score'], 1);

    // Per-factor before/after, keyed by factor name.
    $beforeByFactor = [];
    foreach ($baseFactors as $bf) $beforeByFactor[$bf['factor']] = $bf['points'];
    $factorDeltas = [];
    foreach ($projFactors as $pf) {
        $before = $beforeByFactor[$pf['factor']] ?? 0.0;
        $factorDeltas[] = [
            'factor' => $pf['factor'],
            'before' => round($before, 1),
            'after'  => round($pf['points'], 1),
            'change' => round($pf['points'] - $before, 1),
        ];
    }
}

Response::success([
    'target_type'   => $targetType,
    'target_value'  => $targetValue,
    'baseline'      => ['score' => (float) $baseline['score'], 'factors' => $baseFactors],
    'projected'     => $projected,
    'delta'         => $delta,
    'factor_deltas' => $factorDeltas,
    'applied'       => $applied,
]);
