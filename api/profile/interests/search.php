<?php


// =====================================================================
// FILE: api/profile/interests/search.php
// GET ?q=<text>  -> up to 10 existing interests matching text (autocomplete)
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';
require_once __DIR__ . '/../../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('search');

$pdo = Database::conn();
$q   = trim($_GET['q'] ?? '');
if ($q === '') { Response::success([]); }

$stmt = $pdo->prepare(
    'SELECT id, name FROM interests WHERE name LIKE ? ORDER BY name ASC LIMIT 10'
);
$stmt->execute(['%' . $q . '%']);
Response::success($stmt->fetchAll());