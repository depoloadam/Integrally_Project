<?php

// =====================================================================
// FILE: api/search/global.php
// GET ?q=&type=all|users|companies|jobs&page=1&limit=20
// Global search used by the top-nav search flow. Returns a unified,
// grouped result set across users, companies, and OPEN jobs.
//
// Follow state is annotated for user/company results when the caller is
// signed in as a user OR a company (via Social::requireActor). Jobs are
// public and carry no follow state.
//
// A blank query returns nothing (the dedicated Search page only fetches
// once the user actually types + submits).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();   // ['type' => 'user'|'company', 'id' => int]
$pdo   = Database::conn();

$q     = trim($_GET['q'] ?? '');
$type  = trim($_GET['type'] ?? 'all');
$page  = max(1, (int) ($_GET['page'] ?? 1));
$limit = (int) ($_GET['limit'] ?? 20);
if ($limit <= 0)  $limit = 20;
if ($limit > 50)  $limit = 50;
$offset = ($page - 1) * $limit;

if (!in_array($type, ['all', 'users', 'companies', 'jobs'], true)) {
    Response::error("type must be 'all', 'users', 'companies', or 'jobs'.", 422);
}

// Blank query -> empty result set (the search page fetches only on submit).
if ($q === '') {
    Response::success([
        'results' => [],
        'page'    => $page,
        'limit'   => $limit,
        'total'   => 0,
        'counts'  => ['users' => 0, 'companies' => 0, 'jobs' => 0],
    ]);
}

$like    = '%' . $q . '%';
$results = [];

$excludeUserId    = $actor['type'] === 'user'    ? $actor['id'] : 0;
$excludeCompanyId = $actor['type'] === 'company' ? $actor['id'] : 0;

// ---- users -----------------------------------------------------------
if ($type === 'all' || $type === 'users') {
    $stmt = $pdo->prepare(
        "SELECT id, uuid, username, first_name, last_name, city, state, profile_pic, is_verified
         FROM users
         WHERE is_active = 1 AND id <> ?
           AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ?
                OR CONCAT(first_name,' ',last_name) LIKE ? OR city LIKE ?)
         ORDER BY username ASC
         LIMIT 50"
    );
    $stmt->execute([$excludeUserId, $like, $like, $like, $like, $like]);
    $userRows = $stmt->fetchAll();

    // Batch-resolve each user's CURRENT job for the "Title @ Company" line.
    $currentJobs = [];
    if ($userRows) {
        $ids = array_map(fn($u) => (int) $u['id'], $userRows);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $js  = $pdo->prepare(
            "SELECT user_id, title, company_name
             FROM job_history
             WHERE user_id IN ($ph) AND end_date IS NULL
             ORDER BY start_date DESC"
        );
        $js->execute($ids);
        foreach ($js->fetchAll() as $j) {
            $uid = (int) $j['user_id'];
            if (!isset($currentJobs[$uid])) {
                $currentJobs[$uid] = [
                    'title'   => $j['title'] ?: null,
                    'company' => $j['company_name'] ?: null,
                ];
            }
        }
    }

    foreach ($userRows as $u) {
        $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
        $results[] = [
            'kind'     => 'user',
            'uuid'     => $u['uuid'],
            'title'    => $u['username'],
            'subtitle' => $name !== '' ? $name : null,
            'location' => trim(($u['city'] ?? '') . ($u['state'] ? ', ' . $u['state'] : ''), ', ') ?: null,
            'image'    => $u['profile_pic'] ?: null,
            'verified' => (bool) $u['is_verified'],
            'job'      => $currentJobs[(int) $u['id']] ?? null,
        ];
    }
}

// ---- companies -------------------------------------------------------
if ($type === 'all' || $type === 'companies') {
    $stmt = $pdo->prepare(
        "SELECT uuid, name, industry, city, state, logo, is_verified
         FROM companies
         WHERE is_active = 1 AND id <> ?
           AND (name LIKE ? OR industry LIKE ? OR city LIKE ?)
         ORDER BY name ASC LIMIT 50"
    );
    $stmt->execute([$excludeCompanyId, $like, $like, $like]);
    foreach ($stmt->fetchAll() as $c) {
        $results[] = [
            'kind'     => 'company',
            'uuid'     => $c['uuid'],
            'title'    => $c['name'],
            'subtitle' => $c['industry'] ?: null,
            'location' => trim(($c['city'] ?? '') . ($c['state'] ? ', ' . $c['state'] : ''), ', ') ?: null,
            'image'    => $c['logo'] ?: null,
            'verified' => (bool) $c['is_verified'],
        ];
    }
}

// ---- jobs ------------------------------------------------------------
if ($type === 'all' || $type === 'jobs') {
    $stmt = $pdo->prepare(
        "SELECT j.uuid, j.title, j.location, j.employment_type, j.remote_policy,
                j.salary_min, j.salary_max, j.salary_currency,
                c.uuid AS company_uuid, c.name AS company_name, c.logo AS company_logo
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         WHERE j.status = 'open'
           AND (j.title LIKE ? OR j.description LIKE ? OR c.name LIKE ? OR j.location LIKE ?)
         ORDER BY j.created_at DESC
         LIMIT 50"
    );
    $stmt->execute([$like, $like, $like, $like]);
    foreach ($stmt->fetchAll() as $r) {
        $results[] = [
            'kind'            => 'job',
            'uuid'            => $r['uuid'],
            'title'           => $r['title'],
            'subtitle'        => $r['company_name'] ?: null,
            'location'        => $r['location'] ?: null,
            'image'           => $r['company_logo'] ?: null,
            'company_uuid'    => $r['company_uuid'],
            'employment_type' => $r['employment_type'] ?: null,
            'remote_policy'   => $r['remote_policy'] ?: null,
            'salary_min'      => $r['salary_min'] !== null ? (int) $r['salary_min'] : null,
            'salary_max'      => $r['salary_max'] !== null ? (int) $r['salary_max'] : null,
            'salary_currency' => $r['salary_currency'] ?: null,
        ];
    }
}

// ---- annotate follow state (users + companies only) ------------------
$followed = ['user' => [], 'company' => []];
$fstmt = $pdo->prepare(
    "SELECT f.target_type,
            CASE WHEN f.target_type='user' THEN u.uuid ELSE c.uuid END AS target_uuid
     FROM follows f
     LEFT JOIN users u     ON f.target_type='user'    AND u.id = f.target_id
     LEFT JOIN companies c ON f.target_type='company' AND c.id = f.target_id
     WHERE f.follower_type = ? AND f.follower_id = ?"
);
$fstmt->execute([$actor['type'], $actor['id']]);
foreach ($fstmt->fetchAll() as $f) {
    if ($f['target_uuid']) $followed[$f['target_type']][$f['target_uuid']] = true;
}
foreach ($results as &$r) {
    if ($r['kind'] === 'user' || $r['kind'] === 'company') {
        $r['following'] = isset($followed[$r['kind']][$r['uuid']]);
    }
}
unset($r);

// ---- counts per group (over the full combined set) -------------------
$counts = ['users' => 0, 'companies' => 0, 'jobs' => 0];
foreach ($results as $r) {
    if ($r['kind'] === 'user')         $counts['users']++;
    elseif ($r['kind'] === 'company')  $counts['companies']++;
    elseif ($r['kind'] === 'job')      $counts['jobs']++;
}

// Simple in-PHP pagination over the combined set.
$total = count($results);
$paged = array_slice($results, $offset, $limit);

Response::success([
    'results' => array_values($paged),
    'page'    => $page,
    'limit'   => $limit,
    'total'   => $total,
    'counts'  => $counts,
]);
