<?php

// =====================================================================
// FILE: api/score/compare.php
// GET  ?target_type=job_title|skill|field & target_value=<string>
//      [ &score_id=<id> ]   optional: compare a SPECIFIC score of the
//                           viewer's instead of their latest.
//
// Returns where the logged-in user stands against EVERYONE who has
// scored the same (target_type, target_value). The comparison pool
// always uses each OTHER user's LATEST score for that target — a fair,
// current-standing snapshot. The viewer's own marker defaults to their
// latest score but can be pinned to an older score via score_id.
//
// This reads only the stored `score_value` column, so it is completely
// independent of whatever the ScoreEngine algorithm eventually becomes.
//
// Response shape:
//   {
//     target_type, target_value,
//     pool_size,          // # of distinct users in the pool (incl. viewer)
//     my_score,           // the viewer's score being compared (float|null)
//     my_score_id,        // which score row was used (int|null)
//     percentile,         // 0-100, "you scored >= this % of people" (int|null)
//     top_percent,        // 100 - percentile, i.e. "Top X%"      (int|null)
//     enough_data         // bool: is the pool big enough to be meaningful?
//   }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

$targetType  = trim($_GET['target_type']  ?? '');
$targetValue = trim($_GET['target_value'] ?? '');
$scoreId     = isset($_GET['score_id']) && $_GET['score_id'] !== ''
                 ? (int) $_GET['score_id'] : null;

$validTypes = ['job_title', 'skill', 'field'];
if (!in_array($targetType, $validTypes, true)) {
    Response::error('Invalid target_type.', 422);
}
if ($targetValue === '') {
    Response::error('target_value is required.', 422);
}

// Minimum other-people needed before a percentile is meaningful. Below
// this we still return the pool size so the UI can say "not enough yet".
const MIN_POOL = 5;   // i.e. viewer + 4 others

// ---------------------------------------------------------------------
// 1. Determine the VIEWER's score to compare.
//    Default: their latest for this target. Optional: a pinned score_id
//    (must belong to the viewer AND match this target).
// ---------------------------------------------------------------------
if ($scoreId !== null) {
    $stmt = $pdo->prepare(
        'SELECT id, score_value FROM scores
         WHERE id = ? AND user_id = ? AND target_type = ? AND target_value = ?
         LIMIT 1'
    );
    $stmt->execute([$scoreId, $userId, $targetType, $targetValue]);
    $mine = $stmt->fetch();
    if (!$mine) {
        Response::error('That score was not found for this target.', 404);
    }
} else {
    $stmt = $pdo->prepare(
        'SELECT id, score_value FROM scores
         WHERE user_id = ? AND target_type = ? AND target_value = ?
         ORDER BY created_at DESC LIMIT 1'
    );
    $stmt->execute([$userId, $targetType, $targetValue]);
    $mine = $stmt->fetch();
}

$myScore   = $mine ? (float) $mine['score_value'] : null;
$myScoreId = $mine ? (int)   $mine['id']          : null;

// ---------------------------------------------------------------------
// 2. Build the comparison pool: each user's LATEST score for this
//    target. One row per user. Includes the viewer (so pool_size is the
//    honest total). We compute the latest per user via a self-join on
//    max(created_at).
// ---------------------------------------------------------------------
$poolSql = '
    SELECT s.user_id, s.score_value
    FROM scores s
    JOIN (
        SELECT user_id, MAX(created_at) AS latest
        FROM scores
        WHERE target_type = ? AND target_value = ?
        GROUP BY user_id
    ) m ON m.user_id = s.user_id AND m.latest = s.created_at
    WHERE s.target_type = ? AND s.target_value = ?';

$stmt = $pdo->prepare($poolSql);
$stmt->execute([$targetType, $targetValue, $targetType, $targetValue]);
$poolRows = $stmt->fetchAll();

// A user could (rarely) have two scores at the exact same created_at.
// Collapse to one score per user, keeping the max, so counts stay honest.
$byUser = [];
foreach ($poolRows as $r) {
    $uid = (int) $r['user_id'];
    $v   = (float) $r['score_value'];
    if (!isset($byUser[$uid]) || $v > $byUser[$uid]) $byUser[$uid] = $v;
}
$poolSize = count($byUser);

// ---------------------------------------------------------------------
// 3. Percentile of the viewer's compared score within the pool.
//    Definition used: "you scored >= this percent of the pool" — the
//    share of pool members whose score is <= yours (inclusive of ties,
//    excluding yourself from the denominator handling below).
// ---------------------------------------------------------------------
$percentile = null;
$topPercent = null;
$enoughData = ($poolSize >= MIN_POOL) && ($myScore !== null);

if ($myScore !== null && $poolSize > 0) {
    // Compare against OTHERS (everyone except the viewer's own pool entry).
    $others = $byUser;
    unset($others[$userId]);
    $otherCount = count($others);

    if ($otherCount > 0) {
        $atOrBelow = 0;
        foreach ($others as $v) {
            if ($v <= $myScore) $atOrBelow++;
        }
        // % of OTHER people you meet or beat.
        $percentile = (int) round(($atOrBelow / $otherCount) * 100);
        $topPercent = 100 - $percentile;
    } else {
        // Only the viewer has scored this target.
        $percentile = null;
        $topPercent = null;
    }
}

Response::success([
    'target_type'  => $targetType,
    'target_value' => $targetValue,
    'pool_size'    => $poolSize,
    'my_score'     => $myScore,
    'my_score_id'  => $myScoreId,
    'percentile'   => $percentile,
    'top_percent'  => $topPercent,
    'enough_data'  => $enoughData,
    'min_pool'     => MIN_POOL,
]);
