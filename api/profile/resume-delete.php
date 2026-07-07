<?php

// =====================================================================
// FILE: api/profile/resume-delete.php
// POST -> removes the logged-in user's resume file and its metadata.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

$stmt = $pdo->prepare(
    "SELECT setting_value FROM user_settings
     WHERE user_id = ? AND setting_key = 'resume_file' LIMIT 1"
);
$stmt->execute([$userId]);
$stored = $stmt->fetchColumn();

if ($stored && preg_match('/^[a-f0-9]{32}\.(pdf|docx?|doc)$/', $stored)) {
    @unlink(__DIR__ . '/../../private/resumes/' . $stored);
}

$del = $pdo->prepare(
    "DELETE FROM user_settings
     WHERE user_id = ? AND setting_key IN ('resume_file', 'resume_name', 'resume_uploaded_at')"
);
$del->execute([$userId]);

Response::success(['deleted' => true]);
