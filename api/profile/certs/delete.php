<?php


// =====================================================================
// FILE: api/profile/certs/delete.php
// POST { id* }
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

$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('A valid record id is required.', 422);

$stmt = $pdo->prepare('DELETE FROM certifications WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);
if ($stmt->rowCount() === 0) Response::error('Record not found.', 404);

Response::success(['deleted' => $id]);