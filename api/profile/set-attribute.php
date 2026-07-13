<?php

// =====================================================================
// FILE: api/profile/set-attribute.php
// ---------------------------------------------------------------------
// POST /api/profile/set-attribute.php  -> add/update ONE flexible field
// Body (JSON): { key, value }
// This is how evolving profile fields (headline, bio, career_goal...)
// get saved — no schema change needed to add a new kind of field.
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

$key   = trim($in['key'] ?? '');
$value = array_key_exists('value', $in) ? (string) $in['value'] : null;

if ($key === '' || strlen($key) > 64) {
    Response::error('A valid attribute key (1–64 chars) is required.', 422);
}
// Keep keys tidy and predictable: lowercase, letters/numbers/underscore.
if (!preg_match('/^[a-z0-9_]+$/', $key)) {
    Response::error('Key may only contain lowercase letters, numbers, and underscores.', 422);
}

// UPSERT: insert, or update the value if this user already has the key.
// Relies on the UNIQUE (user_id, attr_key) constraint in the schema.
$stmt = $pdo->prepare(
    'INSERT INTO user_profile_attributes (user_id, attr_key, attr_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE attr_value = VALUES(attr_value)'
);
$stmt->execute([$userId, $key, $value]);

Response::success(['key' => $key, 'value' => $value]);
