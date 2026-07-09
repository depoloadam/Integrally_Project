<?php

// =====================================================================
// FILE: api/applications/detail.php
// GET ?uuid=<application uuid>
// Company-only, owner-only. Full detail for one application: the
// candidate's answers (labelled against the job's form), the score
// snapshot + breakdown, and resume metadata (download via
// resume.php). View-only.
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

$uuid = trim($_GET['uuid'] ?? '');
if ($uuid === '') Response::error('An application uuid is required.', 422);

$stmt = $pdo->prepare(
    'SELECT a.*, j.uuid AS job_uuid, j.title AS job_title, j.status AS job_status,
            j.accept_until, j.company_id, j.apply_form,
            u.uuid AS user_uuid, u.username, u.first_name, u.last_name,
            u.profile_pic, u.city, u.state, u.country
     FROM job_applications a
     JOIN jobs j  ON j.id = a.job_id
     JOIN users u ON u.id = a.user_id
     WHERE a.uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$a = $stmt->fetch();
if (!$a) Response::error('Application not found.', 404);
if ((int) $a['company_id'] !== $companyId) {
    Response::error('You do not own this application.', 403);
}
// External marks are candidate-only tracking records — never company-viewable.
if (($a['apply_channel'] ?? 'native') === 'external') {
    Response::error('Application not found.', 404);
}

// Pair up the job's form questions with the snapshotted answers.
$form    = Applications::normalizeForm($a['apply_form']);
$answers = $a['answers'] ? json_decode($a['answers'], true) : [];
$qa = [];
foreach ($form['questions'] as $q) {
    $qa[] = [
        'label'  => $q['label'],
        'type'   => $q['type'],
        'answer' => $answers[$q['key']] ?? null,
    ];
}

$derived = Applications::derivedStatus(
    ['status' => $a['status'], 'created_at' => $a['created_at']],
    ['status' => $a['job_status'], 'accept_until' => $a['accept_until']]
);

$full = trim(($a['first_name'] ?? '') . ' ' . ($a['last_name'] ?? ''));
$loc  = array_filter([$a['city'], $a['state'], $a['country']]);

Response::success([
    'uuid'           => $a['uuid'],
    'status'         => $derived,
    'status_label'   => Applications::statusLabel($derived),
    'applied_at'     => $a['created_at'],
    'withdrawn_at'   => $a['withdrawn_at'],
    'answers'        => $qa,
    'score' => [
        'value'     => $a['score_value'] !== null ? (float) $a['score_value'] : null,
        'breakdown' => $a['score_breakdown'] ? json_decode($a['score_breakdown'], true) : null,
        'algo'      => $a['score_algo'],
    ],
    'resume' => [
        'has'  => !empty($a['resume_file']),
        'name' => $a['resume_name'],
    ],
    'job' => [
        'uuid'   => $a['job_uuid'],
        'title'  => $a['job_title'],
        'status' => $a['job_status'],
    ],
    'candidate' => [
        'uuid'      => $a['user_uuid'],
        'username'  => $a['username'],
        'full_name' => $full !== '' ? $full : null,
        'avatar'    => $a['profile_pic'],
        'location'  => $loc ? implode(', ', $loc) : null,
    ],
]);
