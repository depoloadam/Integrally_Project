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

// Optional employer link: resolve a company_uuid to its id, but ONLY if
// that company currently allows being listed as an employer. This prevents
// linking to a company that has the setting turned off.
$companyId = null;
$companyUuid = trim($in['company_uuid'] ?? '');
if ($companyUuid !== '') {
    $cstmt = $pdo->prepare(
        'SELECT id FROM companies
         WHERE uuid = ? AND is_active = 1 AND allow_employee_listing = 1
         LIMIT 1'
    );
    $cstmt->execute([$companyUuid]);
    $crow = $cstmt->fetch();
    if ($crow) $companyId = (int) $crow['id'];
    // If not found / not allowed, we silently store just the typed name.
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
    $companyId,
    !empty($in['start_date']) ? $in['start_date'] : null,
    !empty($in['end_date'])   ? $in['end_date']   : null,
    trim($in['description'] ?? '') ?: null,
]);

Response::success(['id' => (int) $pdo->lastInsertId()], 201);