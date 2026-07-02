<?php

// =====================================================================
// FILE: api/follow/followers.php
// GET ?type=user&uuid=<uuid>     -> followers of a user
// GET ?type=company&uuid=<uuid>  -> followers of a company
// Lists WHO follows the given target. Followers can now be users OR
// companies, so each row carries a `follower_type` plus unified
// uuid / name / avatar fields resolved from the right table.
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

// Polymorphic follower resolution: join both possible follower tables
// and pick the matching one per row.
$stmt = $pdo->prepare(
    "SELECT f.follower_type, f.created_at,
            CASE WHEN f.follower_type = 'user' THEN u.uuid        ELSE c.uuid END AS uuid,
            CASE WHEN f.follower_type = 'user' THEN u.username    ELSE c.name END AS name,
            CASE WHEN f.follower_type = 'user' THEN u.profile_pic ELSE c.logo END AS avatar
     FROM follows f
     LEFT JOIN users u     ON f.follower_type = 'user'    AND u.id = f.follower_id
     LEFT JOIN companies c ON f.follower_type = 'company' AND c.id = f.follower_id
     WHERE f.target_type = ? AND f.target_id = ?
     ORDER BY f.created_at DESC"
);
$stmt->execute([$type, $targetId]);

// Drop orphaned rows (follower deleted) and keep the legacy `username`
// key for user rows so any older client code keeps working.
$out = [];
foreach ($stmt->fetchAll() as $r) {
    if (!$r['uuid']) continue;
    $row = [
        'follower_type' => $r['follower_type'],
        'uuid'          => $r['uuid'],
        'name'          => $r['name'],
        'avatar'        => $r['avatar'],
        'created_at'    => $r['created_at'],
    ];
    if ($r['follower_type'] === 'user') {
        $row['username']    = $r['name'];
        $row['profile_pic'] = $r['avatar'];
    }
    $out[] = $row;
}

Response::success($out);
