<?php

// =====================================================================
// FILE: api/profile/update.php
// ---------------------------------------------------------------------
// PATCH (or POST) /api/profile/update.php   -> update YOUR core fields
// Body (JSON): any of { username, city, state, country }
// Email changes are intentionally handled separately (verification).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'PATCH' && $method !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

// By default a user edits their OWN profile. An admin may target any
// user by passing target_uuid — resolved to that user's id here.
$targetId = $userId;
if (!empty($in['target_uuid'])) {
    if (!Auth::isAdmin()) {
        Response::error('Admin access required to edit another profile.', 403);
    }
    $look = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $look->execute([trim($in['target_uuid'])]);
    $found = $look->fetch();
    if (!$found) Response::error('Target user not found.', 404);
    $targetId = (int) $found['id'];
}

// Whitelist the fields a user may change here.
$allowed = ['username', 'city', 'state', 'country'];
$updates = [];
$params  = [];

foreach ($allowed as $field) {
    if (array_key_exists($field, $in)) {
        $val = trim((string) $in[$field]);

        if ($field === 'username') {
            if ($val === '' || strlen($val) > 50) {
                Response::error('Username must be 1–50 characters.', 422);
            }
            // Ensure the new username isn't taken by someone else.
            $check = $pdo->prepare(
                'SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1'
            );
            $check->execute([$val, $targetId]);
            if ($check->fetch()) {
                Response::error('That username is taken.', 409);
            }
            $updates[] = 'username = ?';
            $params[]  = $val;
        } else {
            $updates[] = "$field = ?";
            $params[]  = ($val === '' ? null : $val);
        }
    }
}

if (empty($updates)) {
    Response::error('No valid fields to update.', 422);
}

$params[] = $targetId;
$sql = 'UPDATE users SET ' . implode(', ', $updates) . ' WHERE id = ?';
$pdo->prepare($sql)->execute($params);

// Return the refreshed core profile.
$stmt = $pdo->prepare(
    'SELECT uuid, username, email, city, state, country, profile_pic
     FROM users WHERE id = ? LIMIT 1'
);
$stmt->execute([$targetId]);
Response::success($stmt->fetch());