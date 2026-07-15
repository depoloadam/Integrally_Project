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
require_once __DIR__ . '/../../src/RichText.php';
require_once __DIR__ . '/../../src/Applications.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

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
$payPeriod = ($in['pay_period'] ?? 'annual') === 'hourly' ? 'hourly' : 'annual';

$applyUrl = trim($in['apply_url'] ?? '');
if ($applyUrl !== '' && !preg_match('#^https?://#i', $applyUrl)) {
    Response::error('apply_url must start with http:// or https://', 422);
}

// ---- Application settings --------------------------------------------
$applyMethods = ['native', 'external', 'both'];
$applyMethod  = trim($in['apply_method'] ?? 'native');
if (!in_array($applyMethod, $applyMethods, true)) {
    Response::error('Invalid apply_method.', 422);
}
// An external / both job needs a link to point at.
if (in_array($applyMethod, ['external', 'both'], true) && $applyUrl === '') {
    Response::error('An external application link is required for this apply method.', 422);
}
// Store a normalized form only when native applications are possible.
$applyForm = null;
if (in_array($applyMethod, ['native', 'both'], true) && isset($in['apply_form'])) {
    $applyForm = json_encode(Applications::normalizeForm($in['apply_form']));
}

$acceptUntil = trim($in['accept_until'] ?? '');
if ($acceptUntil !== '') {
    $d = DateTime::createFromFormat('Y-m-d', $acceptUntil);
    if (!$d || $d->format('Y-m-d') !== $acceptUntil) {
        Response::error('accept_until must be a valid YYYY-MM-DD date.', 422);
    }
} else {
    $acceptUntil = null;
}

$uuid = Auth::uuid();
$stmt = $pdo->prepare(
    'INSERT INTO jobs
       (uuid, company_id, title, description, location, employment_type,
        remote_policy, salary_min, salary_max, salary_currency, pay_period, apply_url,
        apply_method, apply_form, accept_until, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $uuid, $companyId, $title,
    (RichText::clean((string) ($in['description'] ?? '')) ?: null),
    trim($in['location'] ?? '') ?: null,
    $employmentType ?: null,
    $remotePolicy ?: null,
    $salaryMin, $salaryMax, $currency, $payPeriod,
    $applyUrl ?: null,
    $applyMethod, $applyForm, $acceptUntil,
    $status,
]);

Response::success(['uuid' => $uuid, 'id' => (int) $pdo->lastInsertId()], 201);