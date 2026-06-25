<?php


// =====================================================================
// FILE: api/profile/jobs/update.php
// POST { id*, title?, company_name?, company_id?, start_date?, end_date?, description? }
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('A valid record id is required.', 422);

// Ownership check: the row must exist AND belong to this user.
$check = $pdo->prepare('SELECT id FROM job_history WHERE id = ? AND user_id = ? LIMIT 1');
$check->execute([$id, $userId]);
if (!$check->fetch()) {
    Response::error('Record not found.', 404);   // generic: don't reveal others' IDs
}

$allowed = ['title', 'company_name', 'company_id', 'start_date', 'end_date', 'description'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        if ($f === 'title') {
            $v = trim((string) $in[$f]);
            if ($v === '') Response::error('Title cannot be empty.', 422);
            $sets[] = 'title = ?'; $params[] = $v;
        } elseif ($f === 'company_id') {
            $sets[] = 'company_id = ?';
            $params[] = !empty($in[$f]) ? (int) $in[$f] : null;
        } else {
            $v = trim((string) $in[$f]);
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}
if (!$sets) Response::error('No fields to update.', 422);

$params[] = $id;
$pdo->prepare('UPDATE job_history SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

Response::success(['updated' => $id]);