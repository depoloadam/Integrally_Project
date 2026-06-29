<?php

// =====================================================================
// FILE: api/connect/search.php
// GET ?q=&type=all|users|companies&page=1&limit=20
// Searches users and/or companies for the Connect page. Returns a
// unified list with each result's follow state for the current user.
// Requires login (Connect is a signed-in discovery feature).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

$q     = trim($_GET['q'] ?? '');
$type  = trim($_GET['type'] ?? 'all');
$page  = max(1, (int) ($_GET['page'] ?? 1));
$limit = (int) ($_GET['limit'] ?? 20);
if ($limit <= 0)  $limit = 20;
if ($limit > 50)  $limit = 50;
$offset = ($page - 1) * $limit;

if (!in_array($type, ['all', 'users', 'companies'], true)) {
    Response::error("type must be 'all', 'users', or 'companies'.", 422);
}

$like = '%' . $q . '%';
$results = [];

// ---- users -----------------------------------------------------------
if ($type === 'all' || $type === 'users') {
    if ($q === '') {
        // No query: surface some recent active users (excluding self).
        $stmt = $pdo->prepare(
            "SELECT uuid, username, first_name, last_name, city, state, profile_pic, is_verified
             FROM users
             WHERE is_active = 1 AND id <> ?
             ORDER BY created_at DESC
             LIMIT 30"
        );
        $stmt->execute([$userId]);
    } else {
        $stmt = $pdo->prepare(
            "SELECT uuid, username, first_name, last_name, city, state, profile_pic, is_verified
             FROM users
             WHERE is_active = 1 AND id <> ?
               AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ?
                    OR CONCAT(first_name,' ',last_name) LIKE ? OR city LIKE ?)
             ORDER BY username ASC
             LIMIT 30"
        );
        $stmt->execute([$userId, $like, $like, $like, $like, $like]);
    }
    foreach ($stmt->fetchAll() as $u) {
        $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
        $results[] = [
            'kind'      => 'user',
            'uuid'      => $u['uuid'],
            'title'     => $u['username'],
            'subtitle'  => $name !== '' ? $name : null,
            'location'  => trim(($u['city'] ?? '') . ($u['state'] ? ', ' . $u['state'] : ''), ', ') ?: null,
            'image'     => $u['profile_pic'] ?: null,
            'verified'  => (bool) $u['is_verified'],
        ];
    }
}

// ---- companies -------------------------------------------------------
if ($type === 'all' || $type === 'companies') {
    if ($q === '') {
        $stmt = $pdo->prepare(
            "SELECT uuid, name, industry, city, state, logo, is_verified
             FROM companies WHERE is_active = 1
             ORDER BY created_at DESC LIMIT 30"
        );
        $stmt->execute();
    } else {
        $stmt = $pdo->prepare(
            "SELECT uuid, name, industry, city, state, logo, is_verified
             FROM companies
             WHERE is_active = 1
               AND (name LIKE ? OR industry LIKE ? OR city LIKE ?)
             ORDER BY name ASC LIMIT 30"
        );
        $stmt->execute([$like, $like, $like]);
    }
    foreach ($stmt->fetchAll() as $c) {
        $results[] = [
            'kind'      => 'company',
            'uuid'      => $c['uuid'],
            'title'     => $c['name'],
            'subtitle'  => $c['industry'] ?: null,
            'location'  => trim(($c['city'] ?? '') . ($c['state'] ? ', ' . $c['state'] : ''), ', ') ?: null,
            'image'     => $c['logo'] ?: null,
            'verified'  => (bool) $c['is_verified'],
        ];
    }
}

// ---- annotate follow state ------------------------------------------
// Pull the user's follows once and mark each result.
$followed = ['user' => [], 'company' => []];
$fstmt = $pdo->query(
    "SELECT f.target_type, f.target_id,
            CASE WHEN f.target_type='user' THEN u.uuid ELSE c.uuid END AS target_uuid
     FROM follows f
     LEFT JOIN users u     ON f.target_type='user'    AND u.id = f.target_id
     LEFT JOIN companies c ON f.target_type='company' AND c.id = f.target_id
     WHERE f.follower_id = " . (int) $userId
);
foreach ($fstmt->fetchAll() as $f) {
    if ($f['target_uuid']) $followed[$f['target_type']][$f['target_uuid']] = true;
}

foreach ($results as &$r) {
    $r['following'] = isset($followed[$r['kind']][$r['uuid']]);
}
unset($r);

// Simple in-PHP pagination over the combined set.
$total = count($results);
$paged = array_slice($results, $offset, $limit);

Response::success([
    'results' => array_values($paged),
    'page'    => $page,
    'limit'   => $limit,
    'total'   => $total,
]);