<?php

// =====================================================================
// FILE: api/admin/set-role.php
// POST { uuid*, role* }   role: 'user' | 'moderator' | 'admin'
// Admin-only. Changes another user's role.
//
// Safeguards:
//   1. An admin cannot change their OWN role through this endpoint
//      (prevents accidental self-lockout).
//   2. The last remaining admin cannot be demoted (prevents a
//      no-admins-left state).
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

$in   = Response::input();
$uuid = trim($in['uuid'] ?? '');
$role = trim($in['role'] ?? '');

if ($uuid === '') Response::error('A target uuid is required.', 422);
if (!in_array($role, ['user', 'moderator', 'admin'], true)) {
    Response::error("role must be 'user', 'moderator', or 'admin'.", 422);
}

// Resolve target.
$stmt = $pdo->prepare('SELECT id, role, username FROM users WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$target = $stmt->fetch();
if (!$target) Response::error('User not found.', 404);

$targetId      = (int) $target['id'];
$currentRole   = $target['role'];

// Safeguard 1: cannot change your own role here.
if ($targetId === $adminId) {
    Response::error('You cannot change your own role.', 403);
}

// No-op: already that role.
if ($currentRole === $role) {
    Response::success(['uuid' => $uuid, 'role' => $role]);
}

// Safeguard 2: cannot demote the last remaining admin.
if ($currentRole === 'admin' && $role !== 'admin') {
    $countStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    $countStmt->execute();
    $adminCount = (int) $countStmt->fetch()['c'];
    if ($adminCount <= 1) {
        Response::error('Cannot remove the last remaining admin.', 403);
    }
}

$update = $pdo->prepare('UPDATE users SET role = ? WHERE id = ?');
$update->execute([$role, $targetId]);

Audit::log($adminId, 'set_role', 'user', $uuid, '@' . $target['username'],
    ['from' => $currentRole, 'to' => $role]);

Response::success(['uuid' => $uuid, 'role' => $role]);