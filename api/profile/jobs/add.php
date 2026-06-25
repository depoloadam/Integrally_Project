<?php


// =====================================================================
// FILE: api/profile/jobs/add.php
// POST { title*, company_name?, company_id?, start_date?, end_date?, description? }
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

$title = trim($in['title'] ?? '');
if ($title === '') {
    Response::error('Job title is required.', 422);
}

$stmt = $pdo->prepare(
    'INSERT INTO job_history
       (user_id, title, company_name, company_id, start_date, end_date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $userId,
    $title,
    trim($in['company_name'] ?? '') ?: null,
    !empty($in['company_id']) ? (int) $in['company_id'] : null,
    !empty($in['start_date']) ? $in['start_date'] : null,
    !empty($in['end_date'])   ? $in['end_date']   : null,
    trim($in['description'] ?? '') ?: null,
]);

Response::success(['id' => (int) $pdo->lastInsertId()], 201);