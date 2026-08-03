<?php


// =====================================================================
// FILE: api/score/latest.php
// GET (logged in) — the most recent score per distinct target for the
// user. Handy for a profile "scores" panel showing current standings.
//
// Respects score visibility:
//  - Owner viewing their own scores (no uuid, or uuid = self): sees
//    everything, with `hidden` flagged per row so the UI can offer
//    an unhide control.
//  - Visitor viewing someone else's scores: hidden rows are excluded
//    entirely, and if the profile owner has `hide_all_scores` set,
//    NO scores are returned at all.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo      = Database::conn();
$uuid     = trim($_GET['uuid'] ?? '');
$viewerId = Auth::userId();

if ($uuid === '') {
    $userId = Auth::requireLogin();
} else {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $r = $stmt->fetch();
    if (!$r) Response::error('Profile not found.', 404);
    $userId = (int) $r['id'];
}

$isOwner = ($viewerId !== null && $viewerId === $userId);

// If a visitor and the owner has chosen to hide ALL scores, short-circuit.
if (!$isOwner) {
    $hideAll = $pdo->prepare("SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'hide_all_scores' LIMIT 1");
    $hideAll->execute([$userId]);
    $row = $hideAll->fetch();
    if ($row && $row['setting_value'] === '1') {
        Response::success([]);
    }
}

// The profile OWNER's current AI Skillset state. Per the product rule,
// AI scores are available (to the owner AND to public viewers) only when
// the owner has AI enabled — turning it off withdraws AI-inclusivity for
// all parties. $userId is the owner here (self or the ?uuid profile), so
// this is the owner's flag in both cases.
$ownerAiEnabled = false;
$aiFlag = $pdo->prepare(
    "SELECT setting_value FROM user_settings
     WHERE user_id = ? AND setting_key = 'ai_box_enabled' LIMIT 1"
);
$aiFlag->execute([$userId]);
$aiFlagRow = $aiFlag->fetch();
if ($aiFlagRow && $aiFlagRow['setting_value'] === '1') $ownerAiEnabled = true;

// Only carry ai_score through when the owner has AI enabled.
$selectAi = $ownerAiEnabled ? 's.ai_score, s.ai_breakdown,' : '';
$buildSql = function (string $aiCol) {
    return '
    SELECT s.id, s.target_type, s.target_value, s.score_value,
           ' . $aiCol . '
           s.algo_version, s.created_at
    FROM scores s
    JOIN (
        SELECT target_type, target_value, MAX(created_at) AS latest
        FROM scores
        WHERE user_id = ?
        GROUP BY target_type, target_value
    ) m ON m.target_type = s.target_type
       AND m.target_value = s.target_value
       AND m.latest = s.created_at
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC';
};

try {
    $stmt = $pdo->prepare($buildSql($selectAi));
    $stmt->execute([$userId, $userId]);
    $rows = $stmt->fetchAll();
} catch (\PDOException $e) {
    if (strpos($e->getMessage(), 'ai_score') !== false || $e->getCode() === '42S22') {
        $ownerAiEnabled = false;
        $stmt = $pdo->prepare($buildSql(''));   // pre-migration fallback
        $stmt->execute([$userId, $userId]);
        $rows = $stmt->fetchAll();
    } else {
        throw $e;
    }
}

// Pull the set of hidden targets for this user.
$hiddenStmt = $pdo->prepare('SELECT target_type, target_value FROM hidden_scores WHERE user_id = ?');
$hiddenStmt->execute([$userId]);
$hiddenSet = [];
foreach ($hiddenStmt->fetchAll() as $h) {
    $hiddenSet[$h['target_type'] . '|' . $h['target_value']] = true;
}

$out = [];
foreach ($rows as $r) {
    $isHidden = isset($hiddenSet[$r['target_type'] . '|' . $r['target_value']]);
    if ($isHidden && !$isOwner) continue; // visitors never see hidden rows

    $out[] = [
        'id'           => (int) $r['id'],
        'target_type'  => $r['target_type'],
        'target_value' => $r['target_value'],
        'score_value'  => (float) $r['score_value'],
        'ai_score'     => isset($r['ai_score']) && $r['ai_score'] !== null ? (float) $r['ai_score'] : null,
        'ai_breakdown' => isset($r['ai_breakdown']) && $r['ai_breakdown'] ? json_decode($r['ai_breakdown'], true) : null,
        'algo_version' => $r['algo_version'],
        'created_at'   => $r['created_at'],
        'hidden'       => $isHidden,
    ];
}

Response::success([
    'rows'       => $out,
    'ai_enabled' => $ownerAiEnabled,
]);
