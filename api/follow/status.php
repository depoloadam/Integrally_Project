<?php

// =====================================================================
// FILE: api/follow/status.php
// GET ?target_type=...&target_id=...   (or ?type=...&uuid=...)
// Does the CURRENT ACTOR (user or company session) follow this target?
// Used by the follow buttons on profiles and the Connect page.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();

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
     WHERE follower_type = ? AND follower_id = ? AND target_type = ? AND target_id = ? LIMIT 1'
);
$stmt->execute([$actor['type'], $actor['id'], $targetType, $targetId]);
$following = (bool) $stmt->fetch();

// Mutual-follow flag: only meaningful for a USER actor viewing a USER
// target (the endorsement gate). True only when BOTH follow each other.
// Companies and cross-type views always report false. Additive field —
// existing callers that read only `following` are unaffected.
$mutual = false;
if ($actor['type'] === 'user' && $targetType === 'user' && $following && $actor['id'] !== $targetId) {
    $back = $pdo->prepare(
        "SELECT 1 FROM follows
         WHERE follower_type = 'user' AND follower_id = ?
           AND target_type = 'user' AND target_id = ? LIMIT 1"
    );
    $back->execute([$targetId, $actor['id']]);
    $mutual = (bool) $back->fetch();
}

Response::success(['following' => $following, 'mutual' => $mutual]);
