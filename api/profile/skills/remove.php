<?php

// =====================================================================
// FILE: api/profile/skills/remove.php
// POST { skill_id* }
// Unlinks the skill from the user. The master skill row is left intact
// (other users may use it). Cleaning orphaned master rows, if ever
// wanted, is a separate maintenance task.
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';
require_once __DIR__ . '/../../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$skillId = (int) ($in['skill_id'] ?? 0);
if ($skillId <= 0) Response::error('A valid skill_id is required.', 422);

$stmt = $pdo->prepare('DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?');
$stmt->execute([$userId, $skillId]);
if ($stmt->rowCount() === 0) Response::error('You do not have that skill.', 404);

Response::success(['removed' => $skillId]);

