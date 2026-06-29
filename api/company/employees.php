<?php

// =====================================================================
// FILE: api/company/employees.php
// GET ?sort=current|name|recent   (company-only)
// Lists users who have LINKED this company in their job history
// (job_history.company_id = this company). Shows current vs past based
// on whether the role has an end date.
//   sort=current (default) -> current employees first, then by recency
//   sort=name              -> by username
//   sort=recent            -> most recently added first
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();

$sort = trim($_GET['sort'] ?? 'current');
switch ($sort) {
    case 'name':
        $order = 'u.username ASC';
        break;
    case 'recent':
        $order = 'jh.created_at DESC';
        break;
    case 'current':
    default:
        // Current roles (no end date) first, then most recent.
        $order = '(jh.end_date IS NULL) DESC, jh.start_date DESC, jh.created_at DESC';
        break;
}

$stmt = $pdo->prepare(
    "SELECT jh.id, jh.title, jh.start_date, jh.end_date, jh.created_at,
            u.uuid AS user_uuid, u.username, u.first_name, u.last_name,
            u.profile_pic
     FROM job_history jh
     JOIN users u ON u.id = jh.user_id AND u.is_active = 1
     WHERE jh.company_id = ?
     ORDER BY {$order}"
);
$stmt->execute([$companyId]);

$rows = array_map(function ($r) {
    $name = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
    return [
        'record_id'  => (int) $r['id'],
        'user_uuid'  => $r['user_uuid'],
        'username'   => $r['username'],
        'name'       => $name !== '' ? $name : null,
        'profile_pic'=> $r['profile_pic'] ?: null,
        'title'      => $r['title'],
        'start_date' => $r['start_date'],
        'end_date'   => $r['end_date'],
        'is_current' => $r['end_date'] === null,
    ];
}, $stmt->fetchAll());

// Quick summary counts.
$current = 0; $past = 0;
foreach ($rows as $r) { $r['is_current'] ? $current++ : $past++; }

Response::success([
    'employees' => $rows,
    'current'   => $current,
    'past'      => $past,
    'total'     => count($rows),
]);