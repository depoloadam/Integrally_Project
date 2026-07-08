<?php


// =====================================================================
// FILE: api/profile/jobs/update.php
// POST { id*, title?, company_name?, company_uuid?, start_date?, end_date?, description? }
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

$allowed = ['title', 'company_name', 'start_date', 'end_date', 'description'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        if ($f === 'title') {
            $v = trim((string) $in[$f]);
            if ($v === '') Response::error('Title cannot be empty.', 422);
            $sets[] = 'title = ?'; $params[] = $v;
        } else {
            $v = trim((string) $in[$f]);
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}

// Employer link. If company_uuid is present in the payload, resolve it:
//   non-empty + valid + still allows listing -> set company_id
//   empty string ("")                        -> unlink (company_id = NULL)
// This lets the edit modal remove a link by clearing it. Only a company
// that currently allows being listed can be linked.
if (array_key_exists('company_uuid', $in)) {
    $companyUuid = trim((string) $in['company_uuid']);
    $companyId = null;
    if ($companyUuid !== '') {
        $cstmt = $pdo->prepare(
            'SELECT id FROM companies
             WHERE uuid = ? AND is_active = 1 AND allow_employee_listing = 1
             LIMIT 1'
        );
        $cstmt->execute([$companyUuid]);
        $crow = $cstmt->fetch();
        if ($crow) $companyId = (int) $crow['id'];
    }
    $sets[] = 'company_id = ?'; $params[] = $companyId;
}

if (!$sets) Response::error('No fields to update.', 422);

$params[] = $id;
$pdo->prepare('UPDATE job_history SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

Response::success(['updated' => $id]);