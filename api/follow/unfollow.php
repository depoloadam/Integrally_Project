<?php

// =====================================================================
// FILE: api/follow/unfollow.php
// POST { target_type, target_id | target_uuid }
// Removes a follow owned by the CURRENT ACTOR (user or company).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$in    = Response::input();
$pdo   = Database::conn();

$targetType = trim($in['target_type'] ?? '');
$targetId   = (int) ($in['target_id'] ?? 0);

if ($targetType !== 'user' && $targetType !== 'company') {
    Response::error("target_type must be 'user' or 'company'.", 422);
}

// Allow uuid in place of a numeric id (mirrors follow.php).
if ($targetId <= 0 && !empty($in['target_uuid'])) {
    $tbl = $targetType === 'user' ? 'users' : 'companies';
    $look = $pdo->prepare("SELECT id FROM $tbl WHERE uuid = ? LIMIT 1");
    $look->execute([trim($in['target_uuid'])]);
    $found = $look->fetch();
    if ($found) $targetId = (int) $found['id'];
}

if ($targetId <= 0) {
    Response::error('A valid target_id or target_uuid is required.', 422);
}

$stmt = $pdo->prepare(
    'DELETE FROM follows
     WHERE follower_type = ? AND follower_id = ? AND target_type = ? AND target_id = ?'
);
$stmt->execute([$actor['type'], $actor['id'], $targetType, $targetId]);

Response::success(['unfollowed' => ($stmt->rowCount() > 0)]);
