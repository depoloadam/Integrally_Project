<?php

// =====================================================================
// FILE: api/score/score-me.php
// POST { target_type: 'job_title'|'skill'|'field', target_value* }
// Computes (on request) and STORES a new score for the logged-in user.
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

// --- Gate: scoring is locked until the user completes setup ----------
// Onboarding marks 'onboarding_complete' = '1' in user_settings when
// all setup steps are done. Until then, scoring is unavailable.
$gate = $pdo->prepare(
    "SELECT setting_value FROM user_settings
     WHERE user_id = ? AND setting_key = 'onboarding_complete' LIMIT 1"
);
$gate->execute([$userId]);
$gateRow = $gate->fetch();
if (!$gateRow || $gateRow['setting_value'] !== '1') {
    Response::error('Finish setting up your profile before using Score Me!', 403);
}

$targetType  = trim($in['target_type'] ?? '');
$targetValue = trim($in['target_value'] ?? '');

$validTypes = ['job_title', 'skill', 'field'];
if (!in_array($targetType, $validTypes, true)) {
    Response::error("target_type must be one of: " . implode(', ', $validTypes) . '.', 422);
}
if ($targetValue === '') {
    Response::error('target_value is required.', 422);
}
if (strlen($targetValue) > 150) {
    Response::error('target_value is too long (150 max).', 422);
}

// --- Entry cap: limit DISTINCT main entries by plan ------------------
// A "main entry" is a distinct (target_type, target_value) pair — the
// same collapsing latest.php does for the profile scores panel.
// Re-scoring an EXISTING entry only adds history and is always allowed;
// the cap only stops a NEW distinct entry once the profile is full.
// Hidden entries still occupy a slot (hiding is a display choice).
$existsStmt = $pdo->prepare(
    'SELECT 1 FROM scores
     WHERE user_id = ? AND target_type = ? AND target_value = ?
     LIMIT 1'
);
$existsStmt->execute([$userId, $targetType, $targetValue]);
$isExistingEntry = (bool) $existsStmt->fetch();

if (!$isExistingEntry) {
    $countStmt = $pdo->prepare(
        'SELECT COUNT(*) AS c FROM (
            SELECT 1 FROM scores
            WHERE user_id = ?
            GROUP BY target_type, target_value
         ) t'
    );
    $countStmt->execute([$userId]);
    $entryCount = (int) $countStmt->fetch()['c'];

    $plan = Auth::plan();
    $cap  = Auth::entryCapForPlan($plan);

    if ($entryCount >= $cap) {
        $msg = $plan === 'plus'
            ? "You've reached the maximum of {$cap} score entries."
            : "Free accounts can keep up to {$cap} score entries. Upgrade to Plus for up to " . Auth::ENTRY_CAP['plus'] . ", or remove an existing entry to add a new one.";
        Response::error($msg, 403, 'entry_cap');
    }
}

// --- Gather the user's profile data for scoring ----------------------
$profile = gatherProfile($pdo, $userId);

// --- Compute (PLACEHOLDER algorithm) ---------------------------------
$result = ScoreEngine::compute($profile, $targetType, $targetValue);

// --- Store as a NEW row (history preserved) --------------------------
$stmt = $pdo->prepare(
    'INSERT INTO scores
       (user_id, target_type, target_value, score_value, breakdown, algo_version)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $userId,
    $targetType,
    $targetValue,
    $result['score'],
    json_encode($result['breakdown']),
    ScoreEngine::VERSION,
]);

Response::success([
    'id'           => (int) $pdo->lastInsertId(),
    'target_type'  => $targetType,
    'target_value' => $targetValue,
    'score'        => $result['score'],
    'breakdown'    => $result['breakdown'],
    'algo_version' => ScoreEngine::VERSION,
    'computed_at'  => date('c'),
], 201);


/**
 * Gather the profile data the scoring algorithm needs.
 * Now lives on ScoreEngine so Score Me and job applications share one
 * copy. This thin wrapper keeps the existing call site above working.
 */
function gatherProfile(PDO $pdo, int $userId): array
{
    return ScoreEngine::gatherProfile($pdo, $userId);
}
