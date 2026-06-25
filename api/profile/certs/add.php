<?php


// =====================================================================
// FILE: api/profile/certs/add.php
// POST { name*, issuer?, issue_date?, expiry_date?, credential_id? }
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

$name = trim($in['name'] ?? '');
if ($name === '') Response::error('Certification name is required.', 422);

$stmt = $pdo->prepare(
    'INSERT INTO certifications
       (user_id, name, issuer, issue_date, expiry_date, credential_id)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $userId,
    $name,
    trim($in['issuer'] ?? '') ?: null,
    !empty($in['issue_date'])  ? $in['issue_date']  : null,
    !empty($in['expiry_date']) ? $in['expiry_date'] : null,
    trim($in['credential_id'] ?? '') ?: null,
]);

Response::success(['id' => (int) $pdo->lastInsertId()], 201);
