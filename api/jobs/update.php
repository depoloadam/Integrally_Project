<?php

// =====================================================================
// FILE: api/jobs/update.php
// POST { uuid*, ...any updatable fields }
// Company-only, and only the job's OWNING company may edit it.
// Updatable: title, description, location, employment_type, remote_policy,
//            salary_min, salary_max, salary_currency, apply_url, status
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RichText.php';
require_once __DIR__ . '/../../src/Applications.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$companyId = Auth::requireCompany();
$in        = Response::input();
$pdo       = Database::conn();

$uuid = trim($in['uuid'] ?? '');
if ($uuid === '') Response::error('A job uuid is required.', 422);

// Verify ownership. Also load current apply fields so partial updates
// can validate cross-field rules (external/both needs a URL).
$stmt = $pdo->prepare(
    'SELECT id, company_id, apply_url, apply_method FROM jobs WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);
if ((int) $job['company_id'] !== $companyId) {
    Response::error('You can only edit your own jobs.', 403);
}

$empTypes = ['full_time', 'part_time', 'contract', 'internship', 'temporary'];
$remote   = ['onsite', 'hybrid', 'remote'];
$statuses = ['draft', 'open', 'closed'];

$sets = []; $params = [];

if (array_key_exists('title', $in)) {
    $v = trim((string) $in['title']);
    if ($v === '' || mb_strlen($v) > 150) Response::error('Title must be 1–150 chars.', 422);
    $sets[] = 'title = ?'; $params[] = $v;
}
if (array_key_exists('description', $in)) {
    $v = RichText::clean((string) $in['description']);
    $sets[] = 'description = ?'; $params[] = ($v === '' ? null : $v);
}
if (array_key_exists('location', $in)) {
    $v = trim((string) $in['location']);
    $sets[] = 'location = ?'; $params[] = ($v === '' ? null : $v);
}
if (array_key_exists('employment_type', $in)) {
    $v = trim((string) $in['employment_type']);
    if ($v !== '' && !in_array($v, $empTypes, true)) Response::error('Invalid employment_type.', 422);
    $sets[] = 'employment_type = ?'; $params[] = ($v === '' ? null : $v);
}
if (array_key_exists('remote_policy', $in)) {
    $v = trim((string) $in['remote_policy']);
    if ($v !== '' && !in_array($v, $remote, true)) Response::error('Invalid remote_policy.', 422);
    $sets[] = 'remote_policy = ?'; $params[] = ($v === '' ? null : $v);
}
if (array_key_exists('status', $in)) {
    $v = trim((string) $in['status']);
    if (!in_array($v, $statuses, true)) Response::error('Invalid status.', 422);
    $sets[] = 'status = ?'; $params[] = $v;
}
foreach (['salary_min', 'salary_max'] as $f) {
    if (array_key_exists($f, $in)) {
        $v = ($in[$f] === '' || $in[$f] === null) ? null : (int) $in[$f];
        $sets[] = "$f = ?"; $params[] = $v;
    }
}
if (array_key_exists('salary_currency', $in)) {
    $v = strtoupper(trim((string) $in['salary_currency']));
    if (strlen($v) !== 3) Response::error('salary_currency must be a 3-letter code.', 422);
    $sets[] = 'salary_currency = ?'; $params[] = $v;
}
if (array_key_exists('apply_url', $in)) {
    $v = trim((string) $in['apply_url']);
    if ($v !== '' && !preg_match('#^https?://#i', $v)) Response::error('apply_url must start with http(s)://', 422);
    $sets[] = 'apply_url = ?'; $params[] = ($v === '' ? null : $v);
}

// ---- Application settings --------------------------------------------
// Effective apply_url after this update (new value if provided, else current).
$effectiveUrl = array_key_exists('apply_url', $in)
    ? trim((string) $in['apply_url'])
    : (string) ($job['apply_url'] ?? '');

if (array_key_exists('apply_method', $in)) {
    $v = trim((string) $in['apply_method']);
    if (!in_array($v, ['native', 'external', 'both'], true)) {
        Response::error('Invalid apply_method.', 422);
    }
    if (in_array($v, ['external', 'both'], true) && $effectiveUrl === '') {
        Response::error('An external application link is required for this apply method.', 422);
    }
    $sets[] = 'apply_method = ?'; $params[] = $v;
}
if (array_key_exists('apply_form', $in)) {
    // null / empty clears the custom form (back to one-click defaults).
    if ($in['apply_form'] === null || $in['apply_form'] === '') {
        $sets[] = 'apply_form = ?'; $params[] = null;
    } else {
        $sets[] = 'apply_form = ?';
        $params[] = json_encode(Applications::normalizeForm($in['apply_form']));
    }
}
if (array_key_exists('accept_until', $in)) {
    $v = trim((string) $in['accept_until']);
    if ($v === '') {
        $sets[] = 'accept_until = ?'; $params[] = null;
    } else {
        $d = DateTime::createFromFormat('Y-m-d', $v);
        if (!$d || $d->format('Y-m-d') !== $v) {
            Response::error('accept_until must be a valid YYYY-MM-DD date.', 422);
        }
        $sets[] = 'accept_until = ?'; $params[] = $v;
    }
}

if (!$sets) Response::error('No valid fields to update.', 422);

$params[] = (int) $job['id'];
$pdo->prepare('UPDATE jobs SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);

Response::success(['uuid' => $uuid]);