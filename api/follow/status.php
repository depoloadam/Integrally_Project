<?php


// =====================================================================
// FILE: api/follow/status.php
// GET ?target_type=...&target_id=...
// Does the logged-in user follow this target? (for follow buttons)
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId     = Auth::requireLogin();
$pdo        = Database::conn();

// Accept either (target_type + target_id) or (type + uuid). The public
// profile page uses the uuid form so it never handles internal IDs.
$targetType = trim($_GET['target_type'] ?? $_GET['type'] ?? '');
$targetId   = (int) ($_GET['target_id'] ?? 0);

if ($targetType !== 'user' && $targetType !== 'company') {
    Response::error("target_type must be 'user' or 'company'.", 422);
}

if ($targetId <= 0 && !empty($_GET['uuid'])) {
    $tbl = $targetType === 'user' ? 'users' : 'companies';
    $look = $pdo->prepare("SELECT id FROM $tbl WHERE uuid = ? LIMIT 1");
    $look->execute([trim($_GET['uuid'])]);
    $found = $look->fetch();
    if ($found) $targetId = (int) $found['id'];
}

if ($targetId <= 0) {
    Response::error('A valid target_id or uuid is required.', 422);
}

$stmt = $pdo->prepare(
    'SELECT 1 FROM follows
     WHERE follower_id = ? AND target_type = ? AND target_id = ? LIMIT 1'
);
$stmt->execute([$userId, $targetType, $targetId]);

Response::success(['following' => (bool) $stmt->fetch()]);