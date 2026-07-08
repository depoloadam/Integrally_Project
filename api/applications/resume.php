<?php

// =====================================================================
// FILE: api/applications/resume.php
// GET ?uuid=<application uuid>
// Company-only, owner-only. Streams the FROZEN resume copy attached to
// one application. Serves only the owning company's applicants' files;
// there is no cross-company access.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();

$uuid = trim($_GET['uuid'] ?? '');
if ($uuid === '') Response::error('An application uuid is required.', 422);

$stmt = $pdo->prepare(
    'SELECT a.resume_file, a.resume_name, j.company_id
     FROM job_applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$r = $stmt->fetch();
if (!$r) Response::error('Application not found.', 404);
if ((int) $r['company_id'] !== $companyId) {
    Response::error('You do not own this application.', 403);
}

$stored = $r['resume_file'] ?? '';
if ($stored === '' || !preg_match('/^[a-f0-9]{32}\.(pdf|docx?|doc)$/', $stored)) {
    Response::error('No resume attached to this application.', 404);
}

$path = __DIR__ . '/../../private/resumes/' . $stored;
if (!is_file($path)) Response::error('Resume file is missing.', 404);

$ext  = strtolower(pathinfo($stored, PATHINFO_EXTENSION));
$mime = [
    'pdf'  => 'application/pdf',
    'doc'  => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
][$ext] ?? 'application/octet-stream';

$downloadName = $r['resume_name'] ?? ('resume.' . $ext);
$downloadName = preg_replace('/[\x00-\x1F"\\\\]/', '', $downloadName);
if ($downloadName === '') $downloadName = 'resume.' . $ext;

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($path));
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');

readfile($path);
exit;
