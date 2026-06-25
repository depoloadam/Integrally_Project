<?php

// =====================================================================
// FILE: api/jobs/delete.php
// POST { uuid* }   Company-only; only the owning company may delete.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$in        = Response::input();
$pdo       = Database::conn();

$uuid = trim($in['uuid'] ?? '');
if ($uuid === '') Response::error('A job uuid is required.', 422);

$stmt = $pdo->prepare('SELECT id, company_id FROM jobs WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);
if ((int) $job['company_id'] !== $companyId) {
    Response::error('You can only delete your own jobs.', 403);
}

$pdo->prepare('DELETE FROM jobs WHERE id = ?')->execute([(int) $job['id']]);

Response::success(['uuid' => $uuid, 'deleted' => true]);