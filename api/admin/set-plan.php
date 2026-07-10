<?php

// =====================================================================
// FILE: api/admin/set-plan.php
// POST { uuid*, plan* }   plan: 'free' | 'plus'
// Admin-only. Changes another user's account plan/tier.
//
// This is the manual/admin path to Plus until real billing exists.
// Brand-neutral values ('free'|'plus') so a future product rename
// never touches this data.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$in   = Response::input();
$uuid = trim($in['uuid'] ?? '');
$plan = trim($in['plan'] ?? '');

if ($uuid === '') Response::error('A target uuid is required.', 422);
if (!in_array($plan, ['free', 'plus'], true)) {
    Response::error("plan must be 'free' or 'plus'.", 422);
}

// Resolve target.
$stmt = $pdo->prepare('SELECT id, plan FROM users WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$target = $stmt->fetch();
if (!$target) Response::error('User not found.', 404);

$targetId = (int) $target['id'];

// No-op: already on that plan.
if ($target['plan'] === $plan) {
    Response::success(['uuid' => $uuid, 'plan' => $plan]);
}

$update = $pdo->prepare('UPDATE users SET plan = ? WHERE id = ?');
$update->execute([$plan, $targetId]);

Response::success(['uuid' => $uuid, 'plan' => $plan]);
