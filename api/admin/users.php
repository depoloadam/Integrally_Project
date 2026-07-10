<?php

// =====================================================================
// FILE: api/admin/users.php
// GET ?q=<search>&role=<user|moderator|admin>&page=1&limit=25
// Admin-only. Lists/searches users for the admin dashboard.
//   q     -> matches username, email, first_name, or last_name (partial)
//   role  -> optional exact role filter
//   page  -> 1-indexed, default 1
//   limit -> default 25, capped at 100
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$q     = trim($_GET['q'] ?? '');
$role  = trim($_GET['role'] ?? '');
$page  = max(1, (int) ($_GET['page'] ?? 1));
$limit = (int) ($_GET['limit'] ?? 25);
if ($limit <= 0)  $limit = 25;
if ($limit > 100) $limit = 100;
$offset = ($page - 1) * $limit;

$where  = [];
$params = [];

if ($q !== '') {
    $where[] = '(username LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like, $like, $like);
}

if ($role !== '') {
    if (!in_array($role, ['user', 'moderator', 'admin'], true)) {
        Response::error("role must be 'user', 'moderator', or 'admin'.", 422);
    }
    $where[] = 'role = ?';
    $params[] = $role;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

// Total count for pagination (same filters, no limit/offset).
$countStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM users {$whereSql}");
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

// Page of results.
$stmt = $pdo->prepare(
    "SELECT uuid, username, email, role, plan, first_name, last_name,
            is_active, is_verified, created_at
     FROM users
     {$whereSql}
     ORDER BY created_at DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

Response::success([
    'users' => $stmt->fetchAll(),
    'page'  => $page,
    'limit' => $limit,
    'total' => $total,
]);