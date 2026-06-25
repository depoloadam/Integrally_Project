<?php

// =====================================================================
// FILE: api/jobs/create.php
// POST { title*, description?, location?, employment_type?, remote_policy?,
//        salary_min?, salary_max?, salary_currency?, apply_url?, status? }
// Company-only. Creates a job posting owned by the logged-in company.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$in        = Response::input();
$pdo       = Database::conn();

$title = trim($in['title'] ?? '');
if ($title === '' || mb_strlen($title) > 150) {
    Response::error('A job title (1–150 chars) is required.', 422);
}

$empTypes = ['full_time', 'part_time', 'contract', 'internship', 'temporary'];
$remote   = ['onsite', 'hybrid', 'remote'];
$statuses = ['draft', 'open', 'closed'];

$employmentType = trim($in['employment_type'] ?? '');
if ($employmentType !== '' && !in_array($employmentType, $empTypes, true)) {
    Response::error('Invalid employment_type.', 422);
}
$remotePolicy = trim($in['remote_policy'] ?? '');
if ($remotePolicy !== '' && !in_array($remotePolicy, $remote, true)) {
    Response::error('Invalid remote_policy.', 422);
}
$status = trim($in['status'] ?? 'open');
if (!in_array($status, $statuses, true)) {
    Response::error('Invalid status.', 422);
}

$salaryMin = isset($in['salary_min']) && $in['salary_min'] !== '' ? (int) $in['salary_min'] : null;
$salaryMax = isset($in['salary_max']) && $in['salary_max'] !== '' ? (int) $in['salary_max'] : null;
if ($salaryMin !== null && $salaryMax !== null && $salaryMin > $salaryMax) {
    Response::error('salary_min cannot exceed salary_max.', 422);
}
$currency = strtoupper(trim($in['salary_currency'] ?? 'USD'));
if (strlen($currency) !== 3) $currency = 'USD';

$applyUrl = trim($in['apply_url'] ?? '');
if ($applyUrl !== '' && !preg_match('#^https?://#i', $applyUrl)) {
    Response::error('apply_url must start with http:// or https://', 422);
}

$uuid = Auth::uuid();
$stmt = $pdo->prepare(
    'INSERT INTO jobs
       (uuid, company_id, title, description, location, employment_type,
        remote_policy, salary_min, salary_max, salary_currency, apply_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $uuid, $companyId, $title,
    trim($in['description'] ?? '') ?: null,
    trim($in['location'] ?? '') ?: null,
    $employmentType ?: null,
    $remotePolicy ?: null,
    $salaryMin, $salaryMax, $currency,
    $applyUrl ?: null,
    $status,
]);

Response::success(['uuid' => $uuid, 'id' => (int) $pdo->lastInsertId()], 201);