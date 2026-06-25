<?php


// =====================================================================
// FILE: api/follow/counts.php
// GET ?type=user|company&uuid=<uuid>
// Returns follower count (and, for users, following count) for display.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$type = trim($_GET['type'] ?? '');
$uuid = trim($_GET['uuid'] ?? '');

if ($type !== 'user' && $type !== 'company') {
    Response::error("type must be 'user' or 'company'.", 422);
}
if ($uuid === '') {
    Response::error('A uuid is required.', 422);
}

if ($type === 'user') {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
} else {
    $stmt = $pdo->prepare('SELECT id FROM companies WHERE uuid = ? LIMIT 1');
}
$stmt->execute([$uuid]);
$target = $stmt->fetch();
if (!$target) Response::error('Target not found.', 404);
$targetId = (int) $target['id'];

// Followers of this target.
$stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM follows WHERE target_type = ? AND target_id = ?'
);
$stmt->execute([$type, $targetId]);
$followers = (int) $stmt->fetchColumn();

$result = ['followers' => $followers];

// Following count only applies to users (companies don't follow).
if ($type === 'user') {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM follows WHERE follower_id = ?');
    $stmt->execute([$targetId]);
    $result['following'] = (int) $stmt->fetchColumn();
}

Response::success($result);