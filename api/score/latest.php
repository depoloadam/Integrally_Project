<?php


// =====================================================================
// FILE: api/score/latest.php
// GET (logged in) — the most recent score per distinct target for the
// user. Handy for a profile "scores" panel showing current standings.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');

if ($uuid === '') {
    $userId = Auth::requireLogin();
} else {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $r = $stmt->fetch();
    if (!$r) Response::error('Profile not found.', 404);
    $userId = (int) $r['id'];
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

$rows = array_map(function ($r) {
    $r['id']          = (int) $r['id'];
    $r['score_value'] = (float) $r['score_value'];
    return $r;
}, $stmt->fetchAll());

Response::success($rows);