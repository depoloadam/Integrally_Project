<?php


// =====================================================================
// FILE: api/profile/certs/add.php
// POST { name*, issuer?, issue_date?, expiry_date?, credential_id? }
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

$name = trim($in['name'] ?? '');
if ($name === '') Response::error('Certification name is required.', 422);
if (strlen($name) > 150) Response::error('Certification name is too long.', 422);

$issuer = trim($in['issuer'] ?? '') ?: null;

// Duplicate guard: the certifications table has no unique constraint, so a
// blind INSERT lets the same credential be added twice. Treat a cert as a
// duplicate when the same user already has a row with the same name AND the
// same issuer (case-insensitive; general_ci collation folds case for us).
// Name+issuer, not name alone, because "Associate" from AWS and Azure are
// legitimately distinct certs.
$dupe = $pdo->prepare(
    'SELECT 1 FROM certifications
      WHERE user_id = ? AND name = ?
        AND (issuer <=> ?)
      LIMIT 1'
);
$dupe->execute([$userId, $name, $issuer]);
if ($dupe->fetchColumn()) {
    Response::error('You already have that certification on your profile.', 409, 'already_exists');
}

$stmt = $pdo->prepare(
    'INSERT INTO certifications
       (user_id, name, issuer, issue_date, expiry_date, credential_id)
     VALUES (?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $userId,
    $name,
    $issuer,
    !empty($in['issue_date'])  ? $in['issue_date']  : null,
    !empty($in['expiry_date']) ? $in['expiry_date'] : null,
    trim($in['credential_id'] ?? '') ?: null,
]);

Response::success(['id' => (int) $pdo->lastInsertId()], 201);
