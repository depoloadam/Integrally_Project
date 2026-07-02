<?php

// =====================================================================
// FILE: api/admin/companies.php
// GET ?q=&status=active|inactive&page=1&limit=25
// Admin-only. Lists/searches companies for the admin dashboard, with
// each company's open-job count.
//   q      -> matches name, email, or industry (partial)
//   status -> optional active/inactive filter
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$q      = trim($_GET['q'] ?? '');
$status = trim($_GET['status'] ?? '');
$page   = max(1, (int) ($_GET['page'] ?? 1));
$limit  = (int) ($_GET['limit'] ?? 25);
if ($limit <= 0)  $limit = 25;
if ($limit > 100) $limit = 100;
$offset = ($page - 1) * $limit;

$where  = [];
$params = [];

if ($q !== '') {
    $where[] = '(c.name LIKE ? OR c.email LIKE ? OR c.industry LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like, $like);
}
if ($status !== '') {
    if ($status !== 'active' && $status !== 'inactive') {
        Response::error("status must be 'active' or 'inactive'.", 422);
    }
    $where[]  = 'c.is_active = ?';
    $params[] = ($status === 'active') ? 1 : 0;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

// Total count for pagination (same filters, no limit/offset).
$countStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM companies c {$whereSql}");
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

// Page of results, with each company's open-job count.
$stmt = $pdo->prepare(
    "SELECT c.uuid, c.name, c.email, c.industry, c.city, c.state,
            c.is_active, c.is_verified, c.created_at,
            (SELECT COUNT(*) FROM jobs j
             WHERE j.company_id = c.id AND j.status = 'open') AS open_jobs
     FROM companies c
     {$whereSql}
     ORDER BY c.created_at DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

Response::success([
    'companies' => $stmt->fetchAll(),
    'page'      => $page,
    'limit'     => $limit,
    'total'     => $total,
]);
