<?php


// =====================================================================
// FILE: api/profile/interests/remove.php
// POST { interest_id* }
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$interestId = (int) ($in['interest_id'] ?? 0);
if ($interestId <= 0) Response::error('A valid interest_id is required.', 422);

$stmt = $pdo->prepare('DELETE FROM user_interests WHERE user_id = ? AND interest_id = ?');
$stmt->execute([$userId, $interestId]);
if ($stmt->rowCount() === 0) Response::error('You do not have that interest.', 404);

Response::success(['removed' => $interestId]);
