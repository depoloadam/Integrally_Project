<?php

// =====================================================================
// FILE: api/applications/withdraw.php
// POST { uuid }
// The candidate withdraws their OWN application. Only a still-standing
// 'submitted' application can be withdrawn; the row is kept (status ->
// 'withdrawn') so the company's applicant history stays honest.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$uuid = trim($in['uuid'] ?? '');
if ($uuid === '') Response::error('An application uuid is required.', 422);

$stmt = $pdo->prepare(
    'SELECT id, user_id, status, apply_channel FROM job_applications WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$app = $stmt->fetch();
if (!$app) Response::error('Application not found.', 404);
if ((int) $app['user_id'] !== $userId) {
    Response::error('You can only withdraw your own applications.', 403);
}

// External marks are the candidate's own off-platform tracking records
// with no company-side history to preserve — so "remove" hard-deletes,
// letting them re-mark later if they want. Native applications are kept
// (soft-deleted to 'withdrawn') so the company's pipeline stays honest.
if (($app['apply_channel'] ?? 'native') === 'external') {
    $pdo->prepare('DELETE FROM job_applications WHERE id = ?')->execute([(int) $app['id']]);
    Response::success(['uuid' => $uuid, 'status' => 'removed']);
}

if ($app['status'] === 'withdrawn') {
    Response::success(['uuid' => $uuid, 'status' => 'withdrawn']); // idempotent
}

$pdo->prepare(
    "UPDATE job_applications SET status = 'withdrawn', withdrawn_at = NOW() WHERE id = ?"
)->execute([(int) $app['id']]);

Response::success(['uuid' => $uuid, 'status' => 'withdrawn']);
