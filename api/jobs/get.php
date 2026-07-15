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

// Has the current USER already applied? We track the two channels
// separately: has_applied = native Integrally submission (drives the
// Quick-apply button); has_marked_external = the "applied on company
// site" tracking mark (drives the external button state).
$hasApplied = false;
$hasMarkedExternal = false;
$viewerUserId = Auth::userId();
if ($viewerUserId !== null) {
    $ck = $pdo->prepare(
        'SELECT apply_channel FROM job_applications
         WHERE job_id = ? AND user_id = ?'
    );
    $ck->execute([(int) $job['id'], $viewerUserId]);
    foreach ($ck->fetchAll() as $row) {
        if (($row['apply_channel'] ?? 'native') === 'external') $hasMarkedExternal = true;
        else $hasApplied = true;
    }
}

// Owner sees a live applicant count — NATIVE only. External marks are
// personal tracking records the company never receives.
$applicantCount = null;
if ($isOwner) {
    $cnt = $pdo->prepare(
        "SELECT COUNT(*) FROM job_applications
         WHERE job_id = ? AND apply_channel = 'native'"
    );
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
    'pay_period'      => $job['pay_period'] ?? 'annual',
    'apply_url'       => $job['apply_url'],
    'apply_method'    => $job['apply_method'] ?? 'native',
    'apply_form'      => $applyForm,
    'accept_until'    => $job['accept_until'] ?? null,
    'status'          => $job['status'],
    'created_at'      => $job['created_at'],
    'is_owner'        => $isOwner,
    'has_applied'     => $hasApplied,
    'has_marked_external' => $hasMarkedExternal,
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