<?php


// =====================================================================
// FILE: api/profile/education/add.php
// POST { institution?, degree?, field?, start_year?, end_year? }
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

// Require at least one meaningful field so we don't store empty rows.
if (trim($in['institution'] ?? '') === '' && trim($in['degree'] ?? '') === '') {
    Response::error('Provide at least an institution or a degree.', 422);
}

$stmt = $pdo->prepare(
    'INSERT INTO education (user_id, institution, degree, field, start_year, end_year)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $userId,
    trim($in['institution'] ?? '') ?: null,
    trim($in['degree'] ?? '') ?: null,
    trim($in['field'] ?? '') ?: null,
    !empty($in['start_year']) ? (int) $in['start_year'] : null,
    !empty($in['end_year'])   ? (int) $in['end_year']   : null,
]);

Response::success(['id' => (int) $pdo->lastInsertId()], 201);