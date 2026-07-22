<?php

// =====================================================================
// FILE: api/follow/counts.php
// GET ?type=user|company&uuid=<uuid>
// Returns follower count and following count for display. Both users
// and companies can follow now, so both get a `following` count, and
// `followers` counts followers of every type.
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

// Followers of this target (users AND companies).
$stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM follows WHERE target_type = ? AND target_id = ?'
);
$stmt->execute([$type, $targetId]);
$followers = (int) $stmt->fetchColumn();

// How many this identity follows.
$stmt = $pdo->prepare(
    'SELECT COUNT(*) FROM follows WHERE follower_type = ? AND follower_id = ?'
);
$stmt->execute([$type, $targetId]);
$following = (int) $stmt->fetchColumn();

// Whether this target hides their follower/following LISTS (counts stay
// visible; only the tappable member lists are gated). Owner viewing self
// is never hidden. Only users have this setting.
$listsHidden = false;
if ($type === 'user') {
    $viewerId = Auth::userId();
    $isOwner  = ($viewerId !== null && $viewerId === $targetId);
    if (!$isOwner) {
        $ps = $pdo->prepare(
            "SELECT setting_value FROM user_settings
             WHERE user_id = ? AND setting_key = 'hide_follow_lists' LIMIT 1"
        );
        $ps->execute([$targetId]);
        $hp = $ps->fetch();
        $listsHidden = ($hp && $hp['setting_value'] === '1');
    }
}

Response::success([
    'followers'    => $followers,
    'following'    => $following,
    'lists_hidden' => $listsHidden,
]);
