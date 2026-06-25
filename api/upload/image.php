<?php

// =====================================================================
// FILE: api/upload/image.php
// ---------------------------------------------------------------------
// POST (multipart/form-data) with a file field named "image".
// Validates, stores under public/uploads/, returns a public URL.
//
// Used for post media now; reused for profile pictures later (same
// endpoint, the caller just decides what to do with the returned URL).
//
// Storage abstraction: writes to the local path from config now. When
// you move to AWS, swap the "store the file" block for an S3 put and
// return the S3 URL — nothing else changes, and posts.media_url /
// users.profile_pic already just hold a URL string.
//
// SECURITY (file uploads are high-risk; each guard matters):
//   - Auth required (user OR company session).
//   - Whitelist by ACTUAL image content, not filename/extension or the
//     browser-supplied MIME type (both are trivially spoofed).
//   - Hard size cap.
//   - Random server-generated filename (never the user's filename) to
//     prevent path traversal / overwrite / script-name tricks.
//   - Extension derived from the verified type, not the upload.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// --- Require an authenticated session (user or company) --------------
$userId    = Auth::userId();
$companyId = Auth::companyId();
if ($userId === null && $companyId === null) {
    Response::error('You must be logged in to upload.', 401);
}

// --- Basic presence / upload-error checks ----------------------------
if (!isset($_FILES['image'])) {
    Response::error('No file received. Send a multipart form with field "image".', 422);
}

$file = $_FILES['image'];

// PHP reports upload problems via the error code.
if ($file['error'] !== UPLOAD_ERR_OK) {
    $map = [
        UPLOAD_ERR_INI_SIZE   => 'File is larger than the server allows.',
        UPLOAD_ERR_FORM_SIZE  => 'File is too large.',
        UPLOAD_ERR_PARTIAL    => 'Upload was interrupted; please retry.',
        UPLOAD_ERR_NO_FILE    => 'No file was uploaded.',
        UPLOAD_ERR_NO_TMP_DIR => 'Server is missing a temp folder.',
        UPLOAD_ERR_CANT_WRITE => 'Server could not write the file.',
    ];
    Response::error($map[$file['error']] ?? 'Upload failed.', 400);
}

// --- Size cap (5 MB). Enforced here regardless of PHP ini. -----------
$MAX_BYTES = 5 * 1024 * 1024;
if ($file['size'] > $MAX_BYTES) {
    Response::error('Image must be 5 MB or smaller.', 422);
}
if ($file['size'] === 0) {
    Response::error('The uploaded file is empty.', 422);
}

// --- Verify the ACTUAL image type by inspecting file content ---------
// getimagesize() reads the real image header. If the file isn't a
// genuine image, it returns false. This ignores the (spoofable)
// filename extension and the browser-provided MIME type entirely.
$info = @getimagesize($file['tmp_name']);
if ($info === false) {
    Response::error('That file is not a valid image.', 422);
}

// Map the verified image type to an allowed extension. Anything not in
// this whitelist is rejected — no SVG (can carry scripts), no others.
$allowed = [
    IMAGETYPE_JPEG => 'jpg',
    IMAGETYPE_PNG  => 'png',
    IMAGETYPE_GIF  => 'gif',
    IMAGETYPE_WEBP => 'webp',
];
$detectedType = $info[2];   // an IMAGETYPE_* constant
if (!isset($allowed[$detectedType])) {
    Response::error('Only JPG, PNG, GIF, or WEBP images are allowed.', 422);
}
$ext = $allowed[$detectedType];

// --- Build a safe, random filename (never trust the user's) ----------
// Random name removes any chance of path traversal, overwriting another
// file, or smuggling an executable-looking name. Extension comes from
// our verified type, not the upload.
try {
    $random = bin2hex(random_bytes(16));
} catch (Exception $e) {
    Response::error('Could not generate a filename. Try again.', 500);
}
$filename = $random . '.' . $ext;

// --- Resolve the storage location from config ------------------------
$config      = require __DIR__ . '/../../config/config.php';
$uploadsPath = $config['storage']['uploads_path'];   // local disk path
$uploadsUrl  = $config['storage']['uploads_url'];    // public URL prefix

// Make sure the uploads directory exists (create on first use).
if (!is_dir($uploadsPath)) {
    if (!@mkdir($uploadsPath, 0775, true) && !is_dir($uploadsPath)) {
        Response::error('Server upload folder is not available.', 500);
    }
}

$destPath = rtrim($uploadsPath, '/\\') . DIRECTORY_SEPARATOR . $filename;

// --- Move the upload into place --------------------------------------
// move_uploaded_file() also re-checks this was a genuine HTTP upload,
// an extra guard against tricking the script into moving arbitrary files.
if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    Response::error('Could not save the uploaded file.', 500);
}

// --- Return the public URL the caller stores / displays --------------
// This URL is what goes into posts.media_url (or users.profile_pic).
$publicUrl = rtrim($uploadsUrl, '/') . '/' . $filename;

Response::success([
    'url'      => $publicUrl,
    'filename' => $filename,
    'width'    => $info[0],
    'height'   => $info[1],
], 201);