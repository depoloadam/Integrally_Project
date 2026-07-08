<?php

// =====================================================================
// FILE: api/jobs/get.php
// GET ?uuid=<job uuid>  -> full job detail + company info (public).
// A draft/closed job is only visible to its owning company.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Applications.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');
if ($uuid === '') Response::error('A job uuid is required.', 422);

$stmt = $pdo->prepare(
    'SELECT j.*, c.uuid AS company_uuid, c.name AS company_name,
            c.logo AS company_logo, c.industry AS company_industry,
            c.website AS company_website, c.description AS company_description
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     WHERE j.uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);

$viewerCompanyId = Auth::companyId();
$isOwner = ($viewerCompanyId !== null && (int) $job['company_id'] === $viewerCompanyId);

// Hide non-open jobs from everyone but the owner.
if ($job['status'] !== 'open' && !$isOwner) {
    Response::error('Job not found.', 404);
}

// Normalized apply form (so the client can render the apply modal).
$applyForm = Applications::normalizeForm($job['apply_form'] ?? null);

// Has the current USER already applied? (Only relevant to signed-in users.)
$hasApplied = false;
$viewerUserId = Auth::userId();
if ($viewerUserId !== null) {
    $ck = $pdo->prepare(
        'SELECT 1 FROM job_applications WHERE job_id = ? AND user_id = ? LIMIT 1'
    );
    $ck->execute([(int) $job['id'], $viewerUserId]);
    $hasApplied = (bool) $ck->fetch();
}

// Owner sees a live applicant count.
$applicantCount = null;
if ($isOwner) {
    $cnt = $pdo->prepare('SELECT COUNT(*) FROM job_applications WHERE job_id = ?');
    $cnt->execute([(int) $job['id']]);
    $applicantCount = (int) $cnt->fetchColumn();
}

Response::success([
    'uuid'            => $job['uuid'],
    'title'           => $job['title'],
    'description'     => $job['description'],
    'location'        => $job['location'],
    'employment_type' => $job['employment_type'],
    'remote_policy'   => $job['remote_policy'],
    'salary_min'      => $job['salary_min'] !== null ? (int) $job['salary_min'] : null,
    'salary_max'      => $job['salary_max'] !== null ? (int) $job['salary_max'] : null,
    'salary_currency' => $job['salary_currency'],
    'apply_url'       => $job['apply_url'],
    'apply_method'    => $job['apply_method'] ?? 'native',
    'apply_form'      => $applyForm,
    'accept_until'    => $job['accept_until'] ?? null,
    'status'          => $job['status'],
    'created_at'      => $job['created_at'],
    'is_owner'        => $isOwner,
    'has_applied'     => $hasApplied,
    'applicant_count' => $applicantCount,
    'company' => [
        'uuid'        => $job['company_uuid'],
        'name'        => $job['company_name'],
        'logo'        => $job['company_logo'],
        'industry'    => $job['company_industry'],
        'website'     => $job['company_website'],
        'description' => $job['company_description'],
    ],
]);