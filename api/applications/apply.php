<?php

// =====================================================================
// FILE: api/applications/apply.php
// POST (multipart/form-data OR JSON)
//   job_uuid*        the job being applied to
//   answers          JSON object { question_key: answer } (if the job asks)
//   resume_source    'current' | 'upload' | 'none'  (default 'current')
//   resume           file field (only when resume_source = 'upload')
//
// User-only. Creates ONE application per (job, user). Snapshots the
// candidate's answers, resume (frozen copy), and Integrally score
// against the job title, so the company's view never drifts.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Applications.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

// Accept multipart (for resume upload) or JSON.
$isMultipart = isset($_SERVER['CONTENT_TYPE'])
    && stripos($_SERVER['CONTENT_TYPE'], 'multipart/form-data') !== false;
$in = $isMultipart ? $_POST : Response::input();

$jobUuid = trim($in['job_uuid'] ?? '');
if ($jobUuid === '') Response::error('A job_uuid is required.', 422);

// ---- Load the job + its application settings -------------------------
$stmt = $pdo->prepare(
    'SELECT id, title, status, apply_method, apply_form, accept_until
     FROM jobs WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$jobUuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);

if ($job['status'] !== 'open') {
    Response::error('This job is no longer accepting applications.', 403);
}
if (!in_array($job['apply_method'], ['native', 'both'], true)) {
    Response::error('This job does not accept applications on Integrally.', 403);
}

// Past the company cutoff? (Default window only applies AFTER submission,
// so pre-submission we only enforce an explicit accept_until date.)
if (!empty($job['accept_until'])) {
    $cut = strtotime($job['accept_until'] . ' 23:59:59');
    if ($cut !== false && time() > $cut) {
        Response::error('The application window for this job has closed.', 403);
    }
}

// ---- Already applied? ------------------------------------------------
$dupe = $pdo->prepare(
    'SELECT uuid, status FROM job_applications WHERE job_id = ? AND user_id = ? LIMIT 1'
);
$dupe->execute([(int) $job['id'], $userId]);
if ($existing = $dupe->fetch()) {
    Response::error('You have already applied to this job.', 409);
}

// ---- Validate answers against the job's form -------------------------
$form = Applications::normalizeForm($job['apply_form']);

$answersIn = $in['answers'] ?? [];
if (is_string($answersIn)) {
    $decoded = json_decode($answersIn, true);
    $answersIn = is_array($decoded) ? $decoded : [];
}
$answers = Applications::validateAnswers($form, $answersIn);

// ---- Resume snapshot (frozen copy) -----------------------------------
$resumeSource = trim($in['resume_source'] ?? 'current');
$snapFile = null;
$snapName = null;

if ($form['collect_resume'] && $resumeSource !== 'none') {
    $resumeDir = __DIR__ . '/../../private/resumes/';

    if ($resumeSource === 'upload') {
        // A fresh file just for this application.
        if (empty($_FILES['resume']) || !is_uploaded_file($_FILES['resume']['tmp_name'])) {
            Response::error('No resume file received.', 422);
        }
        $file = $_FILES['resume'];
        if ($file['error'] !== UPLOAD_ERR_OK) Response::error('Resume upload failed.', 422);
        if ($file['size'] <= 0 || $file['size'] > 5 * 1024 * 1024) {
            Response::error('Resume must be under 5 MB.', 422);
        }
        // Verify by magic bytes (same policy as profile resume upload).
        $fh = fopen($file['tmp_name'], 'rb');
        $head = $fh ? fread($fh, 8) : '';
        if ($fh) fclose($fh);
        $ext = null;
        if (strncmp($head, '%PDF', 4) === 0)                 $ext = 'pdf';
        elseif (strncmp($head, "PK\x03\x04", 4) === 0)       $ext = 'docx';
        elseif (strncmp($head, "\xD0\xCF\x11\xE0", 4) === 0) $ext = 'doc';
        if ($ext === null) Response::error('Resume must be a PDF, DOC, or DOCX.', 422);

        $snapFile = bin2hex(random_bytes(16)) . '.' . $ext;
        if (!@move_uploaded_file($file['tmp_name'], $resumeDir . $snapFile)) {
            Response::error('Could not store the resume.', 500);
        }
        $orig = preg_replace('/[^\w.\- ]+/u', '', (string) ($file['name'] ?? 'resume'));
        $snapName = mb_substr($orig, 0, 150) ?: ('resume.' . $ext);

    } else {
        // 'current': copy the profile resume as it is right now.
        $meta = $pdo->prepare(
            "SELECT setting_key, setting_value FROM user_settings
             WHERE user_id = ? AND setting_key IN ('resume_file','resume_name')"
        );
        $meta->execute([$userId]);
        $m = [];
        foreach ($meta->fetchAll() as $row) $m[$row['setting_key']] = $row['setting_value'];

        if (empty($m['resume_file'])) {
            Response::error('You have no resume on file. Upload one, or apply without a resume.', 422);
        }
        $srcPath = $resumeDir . $m['resume_file'];
        if (!is_file($srcPath)) {
            Response::error('Your resume file could not be found. Please re-upload it.', 422);
        }
        $ext = pathinfo($m['resume_file'], PATHINFO_EXTENSION) ?: 'pdf';
        $snapFile = bin2hex(random_bytes(16)) . '.' . $ext;
        if (!@copy($srcPath, $resumeDir . $snapFile)) {
            Response::error('Could not snapshot your resume.', 500);
        }
        $snapName = $m['resume_name'] ?? ('resume.' . $ext);
    }
}

// ---- Score snapshot vs the job title ---------------------------------
$score = null;
if ($form['collect_score']) {
    $score = Applications::scoreSnapshot($pdo, $userId, $job['title']);
}

// ---- Insert ----------------------------------------------------------
$uuid = Auth::uuid();
$stmt = $pdo->prepare(
    'INSERT INTO job_applications
       (uuid, job_id, user_id, answers, resume_file, resume_name,
        score_value, score_breakdown, score_algo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([
    $uuid, (int) $job['id'], $userId,
    $answers ? json_encode($answers) : null,
    $snapFile, $snapName,
    $score['value'] ?? null,
    isset($score['breakdown']) ? json_encode($score['breakdown']) : null,
    $score['algo'] ?? null,
]);

Response::success([
    'uuid'        => $uuid,
    'job_uuid'    => $jobUuid,
    'status'      => 'submitted',
    'score_value' => $score['value'] ?? null,
], 201);
