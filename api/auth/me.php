<?php

// =====================================================================
// FILE: api/auth/me.php
// ---------------------------------------------------------------------
// GET /api/auth/me  — returns the current logged-in user, or 401.
// Handy for the frontend to check "am I logged in?" on page load.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

$userId = Auth::requireLogin();

$pdo  = Database::conn();
$stmt = $pdo->prepare(
    'SELECT id, uuid, email, username, role, plan, city, state, country, profile_pic
     FROM users WHERE id = ? LIMIT 1'
);
$stmt->execute([$userId]);
$user = $stmt->fetch();

if (!$user) {
    // Session pointed at a deleted user — clear it.
    Auth::logout();
    Response::error('Authentication required.', 401);
}

$user['id'] = (int) $user['id'];
Response::success($user);