<?php

// =====================================================================
// FILE: api/jobs/list.php
// GET ?q=&location=&employment_type=&remote_policy=&company=<uuid>
//     &page=1&limit=20&mine=1
// Public listing of OPEN jobs (with filters). Joins company info.
//   mine=1  -> the logged-in company's own jobs (any status).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo   = Database::conn();
$page  = max(1, (int) ($_GET['page'] ?? 1));
$limit = (int) ($_GET['limit'] ?? 20);
if ($limit <= 0)  $limit = 20;
if ($limit > 50)  $limit = 50;
$offset = ($page - 1) * $limit;

$where  = [];
$params = [];

$mine = ($_GET['mine'] ?? '') === '1';
if ($mine) {
    $companyId = Auth::requireCompany();
    $where[]   = 'j.company_id = ?';
    $params[]  = $companyId;
    // For "my jobs" we show all statuses (draft/open/closed).
} else {
    // Public listing: only open jobs.
    $where[] = "j.status = 'open'";
}

$q = trim($_GET['q'] ?? '');
if ($q !== '') {
    $where[] = '(j.title LIKE ? OR j.description LIKE ? OR c.name LIKE ?)';
    $like = '%' . $q . '%';
    array_push($params, $like, $like, $like);
}

$location = trim($_GET['location'] ?? '');
if ($location !== '') {
    $where[] = 'j.location LIKE ?';
    $params[] = '%' . $location . '%';
}

$empType = trim($_GET['employment_type'] ?? '');
if ($empType !== '') {
    $where[] = 'j.employment_type = ?';
    $params[] = $empType;
}

$remotePolicy = trim($_GET['remote_policy'] ?? '');
if ($remotePolicy !== '') {
    $where[] = 'j.remote_policy = ?';
    $params[] = $remotePolicy;
}

$companyUuid = trim($_GET['company'] ?? '');
if ($companyUuid !== '') {
    $where[] = 'c.uuid = ?';
    $params[] = $companyUuid;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$countStmt = $pdo->prepare(
    "SELECT COUNT(*) AS c FROM jobs j JOIN companies c ON c.id = j.company_id {$whereSql}"
);
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

$stmt = $pdo->prepare(
    "SELECT j.uuid, j.title, j.location, j.employment_type, j.remote_policy,
            j.salary_min, j.salary_max, j.salary_currency, j.status, j.created_at,
            c.uuid AS company_uuid, c.name AS company_name, c.logo AS company_logo,
            c.industry AS company_industry
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     {$whereSql}
     ORDER BY j.created_at DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

$jobs = array_map(function ($r) {
    $r['salary_min'] = $r['salary_min'] !== null ? (int) $r['salary_min'] : null;
    $r['salary_max'] = $r['salary_max'] !== null ? (int) $r['salary_max'] : null;
    return $r;
}, $stmt->fetchAll());

Response::success([
    'jobs'  => $jobs,
    'page'  => $page,
    'limit' => $limit,
    'total' => $total,
]);