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

// Latest score per (target_type, target_value): take the max created_at
// per target, then join back to get that row's full data.
$sql = '
    SELECT s.id, s.target_type, s.target_value, s.score_value,
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

$stmt = $pdo->prepare($sql);
$stmt->execute([$userId, $userId]);
$rows = $stmt->fetchAll();

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
        'algo_version' => $r['algo_version'],
        'created_at'   => $r['created_at'],
        'hidden'       => $isHidden,
    ];
}

Response::success($out);
