<?php


// =====================================================================
// FILE: api/follow/follow.php
// POST { target_type: 'user'|'company', target_id }
// Creates a follow from the logged-in user to the target.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$targetType = trim($in['target_type'] ?? '');
$targetId   = (int) ($in['target_id'] ?? 0);

// Validate the discriminator: only the two known types are allowed.
if ($targetType !== 'user' && $targetType !== 'company') {
    Response::error("target_type must be 'user' or 'company'.", 422);
}

// Accept a uuid as an alternative to a raw target_id, so the client
// never has to know internal numeric IDs. Resolve it here.
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

// Can't follow yourself (user following their own user account).
if ($targetType === 'user' && $targetId === $userId) {
    Response::error('You cannot follow yourself.', 422);
}

// --- Respect the follower's own "following_enabled" setting ----------
// Default is ON (enabled) when no row exists.
$stmt = $pdo->prepare(
    "SELECT setting_value FROM user_settings
     WHERE user_id = ? AND setting_key = 'following_enabled' LIMIT 1"
);
$stmt->execute([$userId]);
$row = $stmt->fetch();
if ($row && $row['setting_value'] === '0') {
    Response::error('Following is turned off in your settings.', 403);
}

// --- Validate the target actually exists (the polymorphic guard) -----
// This is the application-level integrity check standing in for the
// FK we can't have on a polymorphic column.
if ($targetType === 'user') {
    $chk = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1');
} else {
    $chk = $pdo->prepare('SELECT id FROM companies WHERE id = ? AND is_active = 1 LIMIT 1');
}
$chk->execute([$targetId]);
if (!$chk->fetch()) {
    Response::error('That ' . $targetType . ' does not exist.', 404);
}

// --- Create the follow (idempotent via UNIQUE constraint) ------------
// INSERT IGNORE: re-following something you already follow is a no-op
// rather than an error.
$stmt = $pdo->prepare(
    'INSERT IGNORE INTO follows (follower_id, target_type, target_id)
     VALUES (?, ?, ?)'
);
$stmt->execute([$userId, $targetType, $targetId]);

$alreadyFollowing = ($stmt->rowCount() === 0);

// Notify the target of the new follower (only on a genuinely new follow).
// The follower is always a user; the recipient is the followed user/company.
if (!$alreadyFollowing) {
    Social::notify($targetType, $targetId, 'user', $userId, 'follow');
}

Response::success([
    'target_type'       => $targetType,
    'target_id'         => $targetId,
    'already_following' => $alreadyFollowing,
], $alreadyFollowing ? 200 : 201);