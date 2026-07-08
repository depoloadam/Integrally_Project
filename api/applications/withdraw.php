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
    'SELECT id, user_id, status FROM job_applications WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$app = $stmt->fetch();
if (!$app) Response::error('Application not found.', 404);
if ((int) $app['user_id'] !== $userId) {
    Response::error('You can only withdraw your own applications.', 403);
}
if ($app['status'] === 'withdrawn') {
    Response::success(['uuid' => $uuid, 'status' => 'withdrawn']); // idempotent
}

$pdo->prepare(
    "UPDATE job_applications SET status = 'withdrawn', withdrawn_at = NOW() WHERE id = ?"
)->execute([(int) $app['id']]);

Response::success(['uuid' => $uuid, 'status' => 'withdrawn']);
