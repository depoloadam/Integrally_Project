<?php


// =====================================================================
// FILE: api/profile/skills/search.php
// GET ?q=<text>  -> up to 10 existing master skills matching the text.
// Powers an autocomplete so users pick consistent existing names
// instead of creating near-duplicates ("Powershell" vs "PowerShell").
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo = Database::conn();
$q   = trim($_GET['q'] ?? '');
if ($q === '') { Response::success([]); }

$stmt = $pdo->prepare(
    'SELECT id, name FROM skills WHERE name LIKE ? ORDER BY name ASC LIMIT 10'
);
$stmt->execute(['%' . $q . '%']);
Response::success($stmt->fetchAll());

