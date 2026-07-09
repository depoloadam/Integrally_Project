<?php

// =====================================================================
// FILE: api/applications/for-job.php
// GET ?job_uuid=<uuid>
// Company-only, owner-only. Lists applicants for one of the company's
// own jobs, RANKED BY SCORE SNAPSHOT (highest first; scoreless last).
// Withdrawn applications are included but flagged, so the pipeline
// history stays honest. View-only — v1 has no accept/reject.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Applications.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();

$jobUuid = trim($_GET['job_uuid'] ?? '');
if ($jobUuid === '') Response::error('A job_uuid is required.', 422);

// Load + ownership check.
$stmt = $pdo->prepare(
    'SELECT id, company_id, title, status, accept_until FROM jobs WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$jobUuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);
if ((int) $job['company_id'] !== $companyId) {
    Response::error('You do not own this job posting.', 403);
}

// Applicants + candidate display info. NATIVE channel only — external
// marks are the candidate's personal off-platform tracking records and
// are never surfaced to the company.
$stmt = $pdo->prepare(
    "SELECT a.uuid, a.status, a.created_at, a.withdrawn_at,
            a.score_value, a.resume_file, a.resume_name,
            u.uuid AS user_uuid, u.username, u.first_name, u.last_name,
            u.profile_pic
     FROM job_applications a
     JOIN users u ON u.id = a.user_id
     WHERE a.job_id = ? AND a.apply_channel = 'native'
     ORDER BY (a.score_value IS NULL), a.score_value DESC, a.created_at ASC"
);
$stmt->execute([(int) $job['id']]);

$applicants = [];
$counts = ['submitted' => 0, 'withdrawn' => 0, 'expired' => 0];
foreach ($stmt->fetchAll() as $r) {
    $derived = Applications::derivedStatus(
        ['status' => $r['status'], 'created_at' => $r['created_at']],
        ['status' => $job['status'], 'accept_until' => $job['accept_until']]
    );
    if (isset($counts[$derived])) $counts[$derived]++;

    $full = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
    $applicants[] = [
        'uuid'         => $r['uuid'],
        'status'       => $derived,
        'status_label' => Applications::statusLabel($derived),
        'applied_at'   => $r['created_at'],
        'score_value'  => $r['score_value'] !== null ? (float) $r['score_value'] : null,
        'has_resume'   => !empty($r['resume_file']),
        'candidate' => [
            'uuid'      => $r['user_uuid'],
            'username'  => $r['username'],
            'full_name' => $full !== '' ? $full : null,
            'avatar'    => $r['profile_pic'],
        ],
    ];
}

Response::success([
    'job' => [
        'uuid'   => $jobUuid,
        'title'  => $job['title'],
        'status' => $job['status'],
    ],
    'counts'     => $counts,
    'applicants' => $applicants,
]);
