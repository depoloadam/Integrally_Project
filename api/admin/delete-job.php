<?php

// =====================================================================
// FILE: api/admin/delete-job.php
// POST { uuid* }   Admin-only. Deletes ANY job (owner override).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$in   = Response::input();
$uuid = trim($in['uuid'] ?? '');
if ($uuid === '') Response::error('A job uuid is required.', 422);

$stmt = $pdo->prepare('SELECT id FROM jobs WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);

$pdo->prepare('DELETE FROM jobs WHERE id = ?')->execute([(int) $job['id']]);

Response::success(['uuid' => $uuid, 'deleted' => true]);