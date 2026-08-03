<?php

// =====================================================================
// FILE: api/score/insights.php
// GET (logged in)
//
// Platform-wide scoring intelligence for the Scores hub. This is the
// aggregate counterpart to compare.php (which answers "where do *I*
// stand on one target"). Here we answer the community-level questions
// that make the hub the "bread and butter" page:
//
//   - personal:   the viewer's own latest score per target, with each
//                 target's community average and pool size attached, so
//                 the UI can render per-title tabs without N extra calls.
//   - averages:   platform mean score per target_type (job_title/skill/
//                 field), plus an overall mean and the viewer's own mean.
//   - trending:   the most-scored targets right now, ranked by a blend
//                 of pool size and recent activity, split by type.
//
// Everything reads only the stored `score_value` / `created_at` columns,
// so it is completely independent of the ScoreEngine internals — the
// same durability property compare.php relies on.
//
// A note on fairness: every aggregate uses each user's LATEST score per
// target (one row per user per target), matching compare.php's pool
// definition, so a user who re-scores ten times doesn't skew an average.
//
// Response shape:
//   {
//     generated_at: <iso8601>,
//     personal: [
//       { target_type, target_value, score_value, created_at,
//         hidden, community_avg (float|null), pool_size (int),
//         percentile (int|null), top_percent (int|null),
//         rank (int|null),          // 1-based, 1 = highest in the pool
//         gap_to_avg (float|null),  // your score minus community average
//         pool_min (float|null), pool_max (float|null),
//         histogram (int[10]|null)  // counts in 0-9,10-19,…,90-100
//       }
//     ],
//     personal_mean: float|null,      // mean of the viewer's latest scores
//     averages: {
//       overall: { avg: float|null, samples: int },
//       by_type: { job_title:{avg,samples}, skill:{...}, field:{...} }
//     },
//     trending: {
//       job_title: [ {target_value, pool_size, avg, recent_scores} ],
//       field:     [ ... ],
//       skill:     [ ... ]
//     }
//   }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo    = Database::conn();
$userId = Auth::requireLogin();

// Trending needs a minimum pool so a single self-score can't "trend".
const INSIGHTS_MIN_TREND_POOL = 3;
// How many trending rows per type.
const INSIGHTS_TREND_LIMIT = 8;
// Recent-activity window (days) for the trending blend.
const INSIGHTS_RECENT_DAYS = 30;
const VALID_TYPES = ['job_title', 'skill', 'field'];

// ---------------------------------------------------------------------
// Shared building block: the latest score per (user, target). Every
// aggregate below is computed over this derived set, never over the raw
// scores table, so re-scoring never double-counts. Expressed as a
// reusable subquery string.
// ---------------------------------------------------------------------
// Probe once whether the ai_score column exists (migration_ai_score.sql).
// Everything AI-related below keys off this so an un-migrated DB just
// behaves as if no AI scores exist.
$hasAiColumn = false;
try {
    $pdo->query('SELECT ai_score FROM scores LIMIT 1');
    $hasAiColumn = true;
} catch (\PDOException $e) {
    $hasAiColumn = false;
}

$aiSel = $hasAiColumn ? 's.ai_score,' : '';
$latestPerUserTarget = "
    SELECT s.user_id, s.target_type, s.target_value, s.score_value, $aiSel s.created_at
    FROM scores s
    JOIN (
        SELECT user_id, target_type, target_value, MAX(created_at) AS latest
        FROM scores
        GROUP BY user_id, target_type, target_value
    ) m ON m.user_id = s.user_id
       AND m.target_type = s.target_type
       AND m.target_value = s.target_value
       AND m.latest = s.created_at";

// =====================================================================
// 1. PERSONAL — the viewer's latest score per target, with community
//    average + pool size + percentile attached per target.
// =====================================================================

// Viewer's AI Skillset state. Per product rule: when a user's AI Skillset
// is turned OFF, their AI score is unavailable to everyone (no toggle, no
// value) — so we only ever expose ai_score when this is enabled AND the
// column exists.
$aiEnabled = false;
if ($hasAiColumn) {
    $aiFlag = $pdo->prepare(
        "SELECT setting_value FROM user_settings
         WHERE user_id = ? AND setting_key = 'ai_box_enabled' LIMIT 1"
    );
    $aiFlag->execute([$userId]);
    $aiFlagRow = $aiFlag->fetch();
    if ($aiFlagRow && $aiFlagRow['setting_value'] === '1') $aiEnabled = true;
}

// 1a. Viewer's own latest per target. ai_score is carried through the
//     shared subquery; we only surface it in the payload when enabled.
$mine = $pdo->prepare("
    SELECT lt.target_type, lt.target_value, lt.score_value, "
    . ($aiEnabled ? 'lt.ai_score,' : '') . " lt.created_at
    FROM ($latestPerUserTarget) lt
    WHERE lt.user_id = ?
    ORDER BY lt.score_value DESC");
$mine->execute([$userId]);
$mineRows = $mine->fetchAll();

// 1b. Hidden set, so the UI can flag (owner still sees them here).
$hiddenStmt = $pdo->prepare('SELECT target_type, target_value FROM hidden_scores WHERE user_id = ?');
$hiddenStmt->execute([$userId]);
$hiddenSet = [];
foreach ($hiddenStmt->fetchAll() as $h) {
    $hiddenSet[$h['target_type'] . '|' . $h['target_value']] = true;
}

// 1c. Community average + pool size for each of the viewer's targets.
//     One grouped query over all latest scores, filtered to the targets
//     the viewer actually has, keyed for O(1) lookup.
$community = [];   // key "type|value" => ['sum'=>float,'n'=>int,'scores'=>float[]]
if ($mineRows) {
    $allStats = $pdo->query("
        SELECT target_type, target_value, score_value
        FROM ($latestPerUserTarget) lt2");
    foreach ($allStats->fetchAll() as $r) {
        $k = $r['target_type'] . '|' . $r['target_value'];
        if (!isset($community[$k])) $community[$k] = ['sum' => 0.0, 'n' => 0, 'scores' => []];
        $community[$k]['sum'] += (float) $r['score_value'];
        $community[$k]['n']   += 1;
        $community[$k]['scores'][] = (float) $r['score_value'];
    }
}

// 1c-AI. Parallel AI community pool. Per the product rules, the AI pool
//        contains ONLY users whose AI Skillset is CURRENTLY enabled
//        (joined live to user_settings, not merely whoever once stored an
//        ai_score) AND whose latest row actually has an ai_score. So AI
//        scores are only ever compared against other AI scores, and a user
//        who has since turned AI off drops out of the pool entirely.
$aiCommunity = [];
if ($mineRows && $hasAiColumn) {
    $aiStatsSql = "
        SELECT lt3.target_type, lt3.target_value, lt3.ai_score
        FROM ($latestPerUserTarget) lt3
        JOIN user_settings us
          ON us.user_id = lt3.user_id
         AND us.setting_key = 'ai_box_enabled'
         AND us.setting_value = '1'
        WHERE lt3.ai_score IS NOT NULL";
    foreach ($pdo->query($aiStatsSql)->fetchAll() as $r) {
        $k = $r['target_type'] . '|' . $r['target_value'];
        if (!isset($aiCommunity[$k])) $aiCommunity[$k] = ['sum' => 0.0, 'n' => 0, 'scores' => []];
        $aiCommunity[$k]['sum'] += (float) $r['ai_score'];
        $aiCommunity[$k]['n']   += 1;
        $aiCommunity[$k]['scores'][] = (float) $r['ai_score'];
    }
}

// Per-target standing stats for a value within its pool. Extracted so the
// Standard and AI pools compute identically (no logic drift). Returns the
// full bundle the UI needs; nulls when the pool is empty.
$standingStats = function (?array $pool, ?float $myVal): array {
    $out = [
        'community_avg' => null, 'pool_size' => 0, 'percentile' => null,
        'top_percent' => null, 'rank' => null, 'gap_to_avg' => null,
        'pool_min' => null, 'pool_max' => null, 'histogram' => null,
    ];
    if ($pool === null || $myVal === null || empty($pool['scores'])) return $out;
    $scores = $pool['scores'];
    $out['pool_size'] = $pool['n'];
    $out['community_avg'] = $pool['n'] > 0 ? round($pool['sum'] / $pool['n'], 1) : null;
    if ($out['community_avg'] !== null) $out['gap_to_avg'] = round($myVal - $out['community_avg'], 1);
    $out['pool_min'] = round(min($scores), 1);
    $out['pool_max'] = round(max($scores), 1);

    $above = 0; foreach ($scores as $v) if ($v > $myVal) $above++;
    $out['rank'] = $above + 1;

    $hist = array_fill(0, 10, 0);
    foreach ($scores as $v) { $b = (int) floor(max(0, min(100, $v)) / 10); if ($b > 9) $b = 9; $hist[$b]++; }
    $out['histogram'] = $hist;

    $others = $scores;
    $selfIdx = array_search($myVal, $others, true);
    if ($selfIdx !== false) array_splice($others, $selfIdx, 1);
    $otherCount = count($others);
    if ($otherCount > 0) {
        $atOrBelow = 0; foreach ($others as $v) if ($v <= $myVal) $atOrBelow++;
        $out['percentile'] = (int) round(($atOrBelow / $otherCount) * 100);
        $out['top_percent'] = 100 - $out['percentile'];
    }
    return $out;
};

$personal = [];
$personalSum = 0.0;
$personalN = 0;
foreach ($mineRows as $r) {
    $k = $r['target_type'] . '|' . $r['target_value'];
    $myVal = (float) $r['score_value'];
    $personalSum += $myVal;
    $personalN++;

    // Standard standing (Standard pool).
    $std = $standingStats($community[$k] ?? null, $myVal);

    // AI standing (AI pool) — only when the viewer has an AI score for
    // this target AND their skillset is enabled. Otherwise no AI standing.
    $myAi = ($aiEnabled && isset($r['ai_score']) && $r['ai_score'] !== null)
        ? (float) $r['ai_score'] : null;
    $aiStd = ($myAi !== null)
        ? $standingStats($aiCommunity[$k] ?? null, $myAi)
        : null;

    $personal[] = [
        'target_type'  => $r['target_type'],
        'target_value' => $r['target_value'],
        'score_value'  => $myVal,
        'ai_score'     => $myAi,
        'created_at'   => $r['created_at'],
        'hidden'       => isset($hiddenSet[$k]),
        // Standard standing (Standard pool).
        'community_avg' => $std['community_avg'],
        'pool_size'    => $std['pool_size'],
        'percentile'   => $std['percentile'],
        'top_percent'  => $std['top_percent'],
        'rank'         => $std['rank'],
        'gap_to_avg'   => $std['gap_to_avg'],
        'pool_min'     => $std['pool_min'],
        'pool_max'     => $std['pool_max'],
        'histogram'    => $std['histogram'],
        // AI standing (AI pool) — null when the viewer has no AI score here.
        'ai_community_avg' => $aiStd['community_avg'] ?? null,
        'ai_pool_size'    => $aiStd['pool_size'] ?? 0,
        'ai_percentile'   => $aiStd['percentile'] ?? null,
        'ai_top_percent'  => $aiStd['top_percent'] ?? null,
        'ai_rank'         => $aiStd['rank'] ?? null,
        'ai_gap_to_avg'   => $aiStd['gap_to_avg'] ?? null,
        'ai_pool_min'     => $aiStd['pool_min'] ?? null,
        'ai_pool_max'     => $aiStd['pool_max'] ?? null,
        'ai_histogram'    => $aiStd['histogram'] ?? null,
    ];
}
$personalMean = $personalN > 0 ? round($personalSum / $personalN, 1) : null;

// =====================================================================
// 2. AVERAGES — platform mean per target_type + overall.
//    Computed over latest-per-user-target so it's a fair population mean.
// =====================================================================
$byType = [];
foreach (VALID_TYPES as $t) $byType[$t] = ['avg' => null, 'samples' => 0];
$overallSum = 0.0;
$overallN = 0;

$typeStats = $pdo->query("
    SELECT target_type, COUNT(*) AS n, AVG(score_value) AS avg_score
    FROM ($latestPerUserTarget) lt3
    GROUP BY target_type");
foreach ($typeStats->fetchAll() as $r) {
    $t = $r['target_type'];
    if (!in_array($t, VALID_TYPES, true)) continue;
    $n = (int) $r['n'];
    $byType[$t] = ['avg' => $n > 0 ? round((float) $r['avg_score'], 1) : null, 'samples' => $n];
    $overallSum += (float) $r['avg_score'] * $n;
    $overallN += $n;
}
$overallAvg = $overallN > 0 ? round($overallSum / $overallN, 1) : null;

// =====================================================================
// 3. TRENDING — most-scored targets, split by type. Ranked by a blend
//    of total pool size and recent activity so genuinely active targets
//    surface over merely large historical ones. Requires a minimum pool
//    so nothing trends off a single score.
// =====================================================================
$trending = ['job_title' => [], 'skill' => [], 'field' => []];

$trendStmt = $pdo->prepare("
    SELECT target_type, target_value, pool_size, avg_score, recent_scores
    FROM (
        SELECT lt.target_type, lt.target_value,
               COUNT(*) AS pool_size,
               AVG(lt.score_value) AS avg_score,
               SUM(CASE WHEN lt.created_at >= (NOW() - INTERVAL ? DAY) THEN 1 ELSE 0 END) AS recent_scores
        FROM ($latestPerUserTarget) lt
        GROUP BY lt.target_type, lt.target_value
        HAVING pool_size >= ?
    ) agg
    ORDER BY (recent_scores * 2 + pool_size) DESC, pool_size DESC");
$trendStmt->execute([INSIGHTS_RECENT_DAYS, INSIGHTS_MIN_TREND_POOL]);

$perTypeCount = ['job_title' => 0, 'skill' => 0, 'field' => 0];
foreach ($trendStmt->fetchAll() as $r) {
    $t = $r['target_type'];
    if (!isset($trending[$t])) continue;
    if ($perTypeCount[$t] >= INSIGHTS_TREND_LIMIT) continue;
    $perTypeCount[$t]++;
    $trending[$t][] = [
        'target_value'  => $r['target_value'],
        'pool_size'     => (int) $r['pool_size'],
        'avg'           => round((float) $r['avg_score'], 1),
        'recent_scores' => (int) $r['recent_scores'],
    ];
}

Response::success([
    'generated_at'  => date('c'),
    'ai_enabled'    => $aiEnabled,
    'personal'      => $personal,
    'personal_mean' => $personalMean,
    'averages'      => [
        'overall' => ['avg' => $overallAvg, 'samples' => $overallN],
        'by_type' => $byType,
    ],
    'trending'      => $trending,
]);
