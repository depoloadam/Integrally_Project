<?php

// =====================================================================
// FILE: api/profile/delete-attribute.php
// ---------------------------------------------------------------------
// POST /api/profile/delete-attribute.php -> remove ONE flexible field
// Body (JSON): { key }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$key = trim($in['key'] ?? '');
if ($key === '') {
    Response::error('An attribute key is required.', 422);
}

$stmt = $pdo->prepare(
    'DELETE FROM user_profile_attributes WHERE user_id = ? AND attr_key = ?'
);
$stmt->execute([$userId, $key]);

Response::success(['deleted' => $key, 'removed' => $stmt->rowCount() > 0]);