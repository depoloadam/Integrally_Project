<?php


// =====================================================================
// FILE: api/follow/followers.php
// GET ?type=user&uuid=<uuid>     -> followers of a user
// GET ?type=company&uuid=<uuid>  -> followers of a company
// Lists the USERS who follow the given target.
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
    Response::error('A target uuid is required.', 422);
}

// Resolve the target uuid -> internal id.
if ($type === 'user') {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
} else {
    $stmt = $pdo->prepare('SELECT id FROM companies WHERE uuid = ? LIMIT 1');
}
$stmt->execute([$uuid]);
$target = $stmt->fetch();
if (!$target) Response::error('Target not found.', 404);
$targetId = (int) $target['id'];

// Followers are always users — join to resolve their display info.
$stmt = $pdo->prepare(
    'SELECT u.uuid, u.username, u.profile_pic, f.created_at
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.target_type = ? AND f.target_id = ?
     ORDER BY f.created_at DESC'
);
$stmt->execute([$type, $targetId]);
Response::success($stmt->fetchAll());