<?php


// =====================================================================
// FILE: api/score/history.php
// GET ?uuid=<uuid> (public) | none (own)
//     optional &target_type=... &target_value=...  to filter
// Returns stored scores, newest first. This is where "show score
// history / progress over time" comes from.
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

$sql    = 'SELECT id, target_type, target_value, score_value, breakdown,
                  algo_version, created_at
           FROM scores WHERE user_id = ?';
$params = [$userId];

// Optional filters to view one target's progress over time.
if (!empty($_GET['target_type'])) {
    $sql .= ' AND target_type = ?';
    $params[] = trim($_GET['target_type']);
}
if (!empty($_GET['target_value'])) {
    $sql .= ' AND target_value = ?';
    $params[] = trim($_GET['target_value']);
}
$sql .= ' ORDER BY created_at DESC LIMIT 100';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

// Decode the stored JSON breakdown back into structured data.
$rows = array_map(function ($r) {
    $r['id']          = (int) $r['id'];
    $r['score_value'] = (float) $r['score_value'];
    $r['breakdown']   = $r['breakdown'] ? json_decode($r['breakdown'], true) : null;
    return $r;
}, $stmt->fetchAll());

Response::success($rows);