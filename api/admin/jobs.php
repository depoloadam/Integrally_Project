<?php

// =====================================================================
// FILE: api/admin/jobs.php
// GET ?q=&status=&page=1&limit=25
// Admin-only. Lists ALL jobs across all companies, any status, with
// the owning company's name. Backs the admin dashboard's jobs section.
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
    $where[] = '(j.title LIKE ? OR c.name LIKE ?)';
    $like = '%' . $q . '%';
    array_push($params, $like, $like);
}
if ($status !== '') {
    if (!in_array($status, ['draft', 'open', 'closed'], true)) {
        Response::error("status must be 'draft', 'open', or 'closed'.", 422);
    }
    $where[] = 'j.status = ?';
    $params[] = $status;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$countStmt = $pdo->prepare(
    "SELECT COUNT(*) AS c FROM jobs j JOIN companies c ON c.id = j.company_id {$whereSql}"
);
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

$stmt = $pdo->prepare(
    "SELECT j.uuid, j.title, j.location, j.employment_type, j.remote_policy,
            j.status, j.created_at,
            c.uuid AS company_uuid, c.name AS company_name
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     {$whereSql}
     ORDER BY j.created_at DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

Response::success([
    'jobs'  => $stmt->fetchAll(),
    'page'  => $page,
    'limit' => $limit,
    'total' => $total,
]);