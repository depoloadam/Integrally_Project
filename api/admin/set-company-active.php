<?php

// =====================================================================
// FILE: api/admin/set-company-active.php
// POST { uuid*, active* }   active: true/false (or 1/0)
// Admin-only. Activates or deactivates a COMPANY account. A deactivated
// company cannot sign in (company/login.php already checks is_active)
// and stops appearing in Connect search.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Audit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$adminId = Auth::requireAdmin();
$pdo = Database::conn();

$in     = Response::input();
$uuid   = trim($in['uuid'] ?? '');
$active = filter_var($in['active'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

if ($uuid === '')     Response::error('A company uuid is required.', 422);
if ($active === null) Response::error('active must be true or false.', 422);

$stmt = $pdo->prepare('SELECT id, is_active, name FROM companies WHERE uuid = ? LIMIT 1');
$stmt->execute([$uuid]);
$company = $stmt->fetch();
if (!$company) Response::error('Company not found.', 404);

// No-op: already in that state.
if ((int) $company['is_active'] === ($active ? 1 : 0)) {
    Response::success(['uuid' => $uuid, 'is_active' => $active]);
}

$update = $pdo->prepare('UPDATE companies SET is_active = ? WHERE id = ?');
$update->execute([$active ? 1 : 0, (int) $company['id']]);

Audit::log($adminId, 'set_company_active', 'company', $uuid, $company['name'],
    ['to' => $active ? 'active' : 'inactive']);

Response::success(['uuid' => $uuid, 'is_active' => $active]);
