<?php

// =====================================================================
// FILE: api/follow/following.php
// GET ?uuid=<uuid>  -> who that user follows (public)
// GET (no uuid, logged in) -> who YOU follow
// Optional ?type=user|company to filter.
// Resolves target names so the client gets a usable list, not bare IDs.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');
$type = trim($_GET['type'] ?? '');   // optional filter

if ($uuid === '') {
    $userId = Auth::requireLogin();
} else {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $r = $stmt->fetch();
    if (!$r) Response::error('Profile not found.', 404);
    $userId = (int) $r['id'];
}

$sql    = 'SELECT target_type, target_id, created_at FROM follows WHERE follower_id = ?';
$params = [$userId];
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
    // Skip targets that no longer exist (orphaned follows) — and they
    // can be cleaned up lazily here if desired.
    if (isset($entry['uuid'])) {
        $out[] = $entry;
    }
}

Response::success($out);
