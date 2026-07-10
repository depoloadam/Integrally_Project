<?php

// =====================================================================
// FILE: api/admin/set-active.php
// POST { uuid*, active* }   active: true/false (or 1/0)
// Admin-only. Activates or deactivates a USER account. A deactivated
// user cannot sign in (login.php already checks is_active) and stops
// appearing in Connect search.
//
// Safeguards:
//   1. An admin cannot deactivate their OWN account (self-lockout).
//   2. The last remaining ACTIVE admin cannot be deactivated.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Audit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$adminId = Auth::requireAdmin();
$pdo     = Database::conn();

$in     = Response::input();
$uuid   = trim($in['uuid'] ?? '');
$active = filter_var($in['active'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

if ($uuid === '')     Response::error('A target uuid is required.', 422);
if ($active === null) Response::error('active must be true or false.', 422);

// Resolve target.
$stmt = $pdo->prepare('SELECT id, role, is_active, username FROM users WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$target = $stmt->fetch();
if (!$target) Response::error('User not found.', 404);

$targetId = (int) $target['id'];

// Safeguard 1: cannot deactivate yourself.
if (!$active && $targetId === $adminId) {
    Response::error('You cannot deactivate your own account.', 403);
}

// No-op: already in that state.
if ((int) $target['is_active'] === ($active ? 1 : 0)) {
    Response::success(['uuid' => $uuid, 'is_active' => $active]);
}

// Safeguard 2: cannot deactivate the last remaining active admin.
if (!$active && $target['role'] === 'admin') {
    $countStmt = $pdo->query(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1"
    );
    if ((int) $countStmt->fetch()['c'] <= 1) {
        Response::error('Cannot deactivate the last remaining active admin.', 403);
    }
}

$update = $pdo->prepare('UPDATE users SET is_active = ? WHERE id = ?');
$update->execute([$active ? 1 : 0, $targetId]);

Audit::log($adminId, 'set_user_active', 'user', $uuid, '@' . $target['username'],
    ['to' => $active ? 'active' : 'inactive']);

Response::success(['uuid' => $uuid, 'is_active' => $active]);
