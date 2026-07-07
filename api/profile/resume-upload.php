<?php

// =====================================================================
// FILE: api/profile/resume-upload.php
// POST (multipart/form-data) field "resume" -> stores the file PRIVATELY
// and records metadata in user_settings. Replaces any previous resume.
//
// PRIVACY: files land in private/resumes/ (blocked from direct web
// access by private/.htaccess) and are only ever served through
// resume-download.php, which requires the owner's session.
//
// SECURITY:
//   - auth required
//   - 5 MB size cap
//   - only PDF / DOC / DOCX, verified by MAGIC BYTES (not extension):
//       PDF  -> %PDF
//       DOCX -> PK\x03\x04 (zip container)
//       DOC  -> D0 CF 11 E0 (OLE compound file)
//   - random stored filename; the original name is kept only as display
//     metadata (sanitized + truncated)
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

if (empty($_FILES['resume']) || !is_uploaded_file($_FILES['resume']['tmp_name'])) {
    Response::error('No resume file received.', 422);
}
$file = $_FILES['resume'];

if ($file['error'] !== UPLOAD_ERR_OK) {
    Response::error('Upload failed (code ' . (int) $file['error'] . ').', 422);
}

const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
if ($file['size'] <= 0 || $file['size'] > RESUME_MAX_BYTES) {
    Response::error('Resume must be under 5 MB.', 422);
}

// --- Verify content by magic bytes -----------------------------------
$fh = fopen($file['tmp_name'], 'rb');
$head = $fh ? fread($fh, 8) : '';
if ($fh) fclose($fh);

$ext = null;
if (strncmp($head, '%PDF', 4) === 0) {
    $ext = 'pdf';
} elseif (strncmp($head, "PK\x03\x04", 4) === 0) {
    $ext = 'docx';           // zip container (docx)
} elseif (strncmp($head, "\xD0\xCF\x11\xE0", 4) === 0) {
    $ext = 'doc';            // OLE compound file (legacy .doc)
}
if ($ext === null) {
    Response::error('Resume must be a PDF, DOC, or DOCX file.', 422);
}

// --- Private storage location -----------------------------------------
// Lives OUTSIDE public/uploads; private/.htaccess blocks direct access.
$dir = __DIR__ . '/../../private/resumes';
if (!is_dir($dir)) {
    if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
        Response::error('Could not create the resume storage directory.', 500);
    }
}

// --- Remove the previous resume file, if any ---------------------------
$prev = $pdo->prepare(
    "SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'resume_file' LIMIT 1"
);
$prev->execute([$userId]);
$prevFile = $prev->fetchColumn();
if ($prevFile && preg_match('/^[a-f0-9]{32}\.(pdf|docx?|doc)$/', $prevFile)) {
    @unlink($dir . DIRECTORY_SEPARATOR . $prevFile);
}

// --- Store under a random name -----------------------------------------
$stored = bin2hex(random_bytes(16)) . '.' . $ext;
$dest   = $dir . DIRECTORY_SEPARATOR . $stored;
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    Response::error('Could not save the resume.', 500);
}

// --- Record metadata in user_settings ----------------------------------
// Original filename: display only. Strip path bits + control chars,
// truncate well under the VARCHAR(255) column.
$orig = basename((string) $file['name']);
$orig = preg_replace('/[\x00-\x1F\/\\\\]/', '', $orig);
if ($orig === '' ) $orig = 'resume.' . $ext;
if (mb_strlen($orig) > 120) $orig = mb_substr($orig, 0, 120);

$up = $pdo->prepare(
    'INSERT INTO user_settings (user_id, setting_key, setting_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
);
$up->execute([$userId, 'resume_file', $stored]);
$up->execute([$userId, 'resume_name', $orig]);
$up->execute([$userId, 'resume_uploaded_at', date('Y-m-d H:i:s')]);

Response::success([
    'name'        => $orig,
    'uploaded_at' => date('Y-m-d H:i:s'),
]);
