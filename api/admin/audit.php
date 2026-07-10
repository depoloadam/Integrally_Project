<?php

// =====================================================================
// FILE: api/admin/audit.php
// GET ?q=<search>&action=<action>&page=1&limit=25
// Admin-only. Lists admin audit-log entries, newest first.
//   q      -> matches admin_username or target_label (partial)
//   action -> optional exact action filter
//   page   -> 1-indexed, default 1
//   limit  -> default 25, capped at 100
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
$action = trim($_GET['action'] ?? '');
$page   = max(1, (int) ($_GET['page'] ?? 1));
$limit  = (int) ($_GET['limit'] ?? 25);
if ($limit <= 0)  $limit = 25;
if ($limit > 100) $limit = 100;
$offset = ($page - 1) * $limit;

$validActions = [
    'set_role', 'set_plan', 'set_user_active',
    'set_company_active', 'delete_post', 'delete_job',
];

$where  = [];
$params = [];

if ($q !== '') {
    $where[] = '(admin_username LIKE ? OR target_label LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like);
}

if ($action !== '') {
    if (!in_array($action, $validActions, true)) {
        Response::error('Unknown action filter.', 422);
    }
    $where[]  = 'action = ?';
    $params[] = $action;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$countStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM admin_audit_log {$whereSql}");
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

$stmt = $pdo->prepare(
    "SELECT id, admin_id, admin_username, action, target_type,
            target_uuid, target_label, detail, created_at
     FROM admin_audit_log
     {$whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

$rows = [];
foreach ($stmt->fetchAll() as $r) {
    $rows[] = [
        'id'             => (int) $r['id'],
        'admin_id'       => (int) $r['admin_id'],
        'admin_username' => $r['admin_username'],
        'action'         => $r['action'],
        'target_type'    => $r['target_type'],
        'target_uuid'    => $r['target_uuid'],
        'target_label'   => $r['target_label'],
        'detail'         => $r['detail'] === null ? null : json_decode($r['detail'], true),
        'created_at'     => $r['created_at'],
    ];
}

Response::success([
    'entries' => $rows,
    'page'    => $page,
    'limit'   => $limit,
    'total'   => $total,
]);
