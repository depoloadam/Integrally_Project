<?php

// =====================================================================
// FILE: api/settings/set.php
// POST { key, value }   -> set ONE setting (upsert).
//   OR  { settings: { k1: v1, k2: v2 } }  -> set MANY at once.
// Values are stored as strings. Use '1'/'0' for booleans.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

// Default: edit your own settings. Admins may target any user via
// target_uuid.
$targetId = $userId;
if (!empty($in['target_uuid'])) {
    if (!Auth::isAdmin()) {
        Response::error('Admin access required to edit another user\'s settings.', 403);
    }
    $look = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $look->execute([trim($in['target_uuid'])]);
    $found = $look->fetch();
    if (!$found) Response::error('Target user not found.', 404);
    $targetId = (int) $found['id'];
}

// Accept either a single {key,value} or a batch {settings:{...}}.
$pairs = [];
if (isset($in['settings']) && is_array($in['settings'])) {
    foreach ($in['settings'] as $k => $v) {
        $pairs[trim((string) $k)] = (string) $v;
    }
} elseif (isset($in['key'])) {
    $pairs[trim((string) $in['key'])] = (string) ($in['value'] ?? '');
}

if (!$pairs) {
    Response::error('Provide key+value, or a settings object.', 422);
}

// Validate keys: lowercase letters, numbers, underscores; max 64 chars.
foreach (array_keys($pairs) as $k) {
    if ($k === '' || strlen($k) > 64 || !preg_match('/^[a-z0-9_]+$/', $k)) {
        Response::error("Invalid setting key: '$k'.", 422);
    }
}

$stmt = $pdo->prepare(
    'INSERT INTO user_settings (user_id, setting_key, setting_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
);
foreach ($pairs as $k => $v) {
    $stmt->execute([$targetId, $k, $v]);
}

Response::success(['saved' => array_keys($pairs)]);