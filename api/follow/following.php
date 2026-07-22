<?php

// =====================================================================
// FILE: api/follow/following.php
// GET ?uuid=<uuid>  -> who that USER follows (public profile view)
// GET (no uuid, signed in) -> who the CURRENT ACTOR follows — works
//   for both user and company sessions.
// Optional ?type=user|company to filter targets.
// Resolves target names so the client gets a usable list, not bare IDs.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');
$type = trim($_GET['type'] ?? '');   // optional target-type filter

if ($uuid === '') {
    // Whoever is signed in — user OR company.
    $actor        = Social::requireActor();
    $followerType = $actor['type'];
    $followerId   = $actor['id'];
} else {
    // Public lookup by uuid is a USER profile feature.
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $r = $stmt->fetch();
    if (!$r) Response::error('Profile not found.', 404);
    $followerType = 'user';
    $followerId   = (int) $r['id'];

    // --- Follow-list privacy gate ------------------------------------
    // The profile owner may hide their following list from others.
    // Owner viewing their own list always passes.
    $viewerId = Auth::userId();
    $isOwner  = ($viewerId !== null && $viewerId === $followerId);
    if (!$isOwner) {
        $ps = $pdo->prepare(
            "SELECT setting_value FROM user_settings
             WHERE user_id = ? AND setting_key = 'hide_follow_lists' LIMIT 1"
        );
        $ps->execute([$followerId]);
        $hp = $ps->fetch();
        if ($hp && $hp['setting_value'] === '1') {
            Response::error('This user has hidden their following list.', 403, 'follow_lists_hidden');
        }
    }
}

$sql    = 'SELECT target_type, target_id, created_at FROM follows
           WHERE follower_type = ? AND follower_id = ?';
$params = [$followerType, $followerId];
if ($type === 'user' || $type === 'company') {
    $sql .= ' AND target_type = ?';
    $params[] = $type;
}
$sql .= ' ORDER BY created_at DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

// Resolve display info for each target so the UI has names/uuids.
$out = [];
foreach ($rows as $r) {
    $entry = [
        'target_type' => $r['target_type'],
        'target_id'   => (int) $r['target_id'],
        'created_at'  => $r['created_at'],
    ];
    if ($r['target_type'] === 'user') {
        $t = $pdo->prepare('SELECT uuid, username, profile_pic FROM users WHERE id = ? LIMIT 1');
        $t->execute([$r['target_id']]);
        if ($info = $t->fetch()) {
            $entry['uuid']        = $info['uuid'];
            $entry['name']        = $info['username'];
            $entry['profile_pic'] = $info['profile_pic'];
        }
    } else {
        $t = $pdo->prepare('SELECT uuid, name, logo FROM companies WHERE id = ? LIMIT 1');
        $t->execute([$r['target_id']]);
        if ($info = $t->fetch()) {
            $entry['uuid'] = $info['uuid'];
            $entry['name'] = $info['name'];
            $entry['logo'] = $info['logo'];
        }
    }
    // Skip targets that no longer exist (orphaned follows).
    if (isset($entry['uuid'])) {
        $out[] = $entry;
    }
}

Response::success($out);
