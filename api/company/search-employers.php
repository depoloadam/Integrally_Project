<?php

// =====================================================================
// FILE: api/company/search-employers.php
// GET ?q=<name>   (login required)
// Live-search company accounts a user can list as their employer in job
// history. Only returns companies that have allow_employee_listing = 1.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('search');

Auth::requireLogin();
$pdo = Database::conn();

$q = trim($_GET['q'] ?? '');
if (mb_strlen($q) < 2) {
    // Require a couple characters to avoid dumping the whole table.
    Response::success(['companies' => []]);
}

$stmt = $pdo->prepare(
    "SELECT uuid, name, industry, logo
     FROM companies
     WHERE is_active = 1
       AND allow_employee_listing = 1
       AND name LIKE ?
     ORDER BY name ASC
     LIMIT 8"
);
$stmt->execute(['%' . $q . '%']);

Response::success(['companies' => $stmt->fetchAll()]);