<?php

// =====================================================================
// FILE: api/profile/resume-download.php
// GET -> streams the logged-in user's OWN resume.
//
// Resumes are private: the file lives outside the public uploads dir
// and this endpoint only ever serves the caller's own file. There is
// deliberately no ?uuid= parameter — nobody can fetch anyone else's
// resume until a future feature explicitly adds sharing.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

$stmt = $pdo->prepare(
    "SELECT setting_key, setting_value FROM user_settings
     WHERE user_id = ? AND setting_key IN ('resume_file', 'resume_name')"
);
$stmt->execute([$userId]);
$meta = [];
foreach ($stmt->fetchAll() as $r) {
    $meta[$r['setting_key']] = $r['setting_value'];
}

$stored = $meta['resume_file'] ?? '';
if ($stored === '' || !preg_match('/^[a-f0-9]{32}\.(pdf|docx?|doc)$/', $stored)) {
    Response::error('No resume on file.', 404);
}

$path = __DIR__ . '/../../private/resumes/' . $stored;
if (!is_file($path)) {
    Response::error('Resume file is missing.', 404);
}

$ext  = strtolower(pathinfo($stored, PATHINFO_EXTENSION));
$mime = [
    'pdf'  => 'application/pdf',
    'doc'  => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
][$ext] ?? 'application/octet-stream';

$downloadName = $meta['resume_name'] ?? ('resume.' . $ext);
// Header-safe: strip quotes/control chars from the display filename.
$downloadName = preg_replace('/[\x00-\x1F"\\\\]/', '', $downloadName);
if ($downloadName === '') $downloadName = 'resume.' . $ext;

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($path));
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');

readfile($path);
exit;
