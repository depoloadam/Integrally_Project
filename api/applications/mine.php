<?php

// =====================================================================
// FILE: api/applications/mine.php
// GET — the logged-in user's applications, newest first. Each row
// carries the job + company display info and the DERIVED status
// (submitted / withdrawn / expired / job_unavailable). Shown inside
// the Job Search tab.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Applications.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

// LEFT JOIN so a deleted job still lists the application (as
// 'job_unavailable') rather than vanishing.
$stmt = $pdo->prepare(
    'SELECT a.uuid, a.status, a.apply_channel, a.created_at, a.withdrawn_at,
            a.score_value, a.resume_name,
            j.uuid AS job_uuid, j.title AS job_title, j.status AS job_status,
            j.location, j.employment_type, j.remote_policy, j.accept_until, j.apply_url,
            c.uuid AS company_uuid, c.name AS company_name, c.logo AS company_logo
     FROM job_applications a
     LEFT JOIN jobs j      ON j.id = a.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT 200'
);
$stmt->execute([$userId]);

$out = [];
foreach ($stmt->fetchAll() as $r) {
    $jobRef = $r['job_uuid'] === null ? null
        : ['status' => $r['job_status'], 'accept_until' => $r['accept_until']];
    $derived = Applications::derivedStatus(
        ['status' => $r['status'], 'created_at' => $r['created_at']],
        $jobRef
    );

    $channel = ($r['apply_channel'] ?? 'native') === 'external' ? 'external' : 'native';

    $out[] = [
        'uuid'          => $r['uuid'],
        'status'        => $derived,
        'status_label'  => Applications::statusLabel($derived),
        'apply_channel' => $channel,
        'channel_label' => $channel === 'external' ? 'Applied on company site' : 'Quick applied',
        'can_withdraw'  => ($derived === 'submitted'),
        'applied_at'    => $r['created_at'],
        'score_value'   => $r['score_value'] !== null ? (float) $r['score_value'] : null,
        'resume_name'   => $r['resume_name'],
        'job' => $r['job_uuid'] === null ? null : [
            'uuid'            => $r['job_uuid'],
            'title'           => $r['job_title'],
            'location'        => $r['location'],
            'employment_type' => $r['employment_type'],
            'remote_policy'   => $r['remote_policy'],
            'apply_url'       => $channel === 'external' ? $r['apply_url'] : null,
        ],
        'company' => $r['company_uuid'] === null ? null : [
            'uuid' => $r['company_uuid'],
            'name' => $r['company_name'],
            'logo' => $r['company_logo'],
        ],
    ];
}

Response::success(['applications' => $out]);
