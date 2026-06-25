<?php


// =====================================================================
// FILE: api/profile/certs/list.php
// GET ?uuid=<uuid> (public) | none (own)
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');

if ($uuid === '') {
    $userId = Auth::requireLogin();
} else {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $row = $stmt->fetch();
    if (!$row) Response::error('Profile not found.', 404);
    $userId = (int) $row['id'];
}

$stmt = $pdo->prepare(
    'SELECT id, name, issuer, issue_date, expiry_date, credential_id
     FROM certifications
     WHERE user_id = ?
     ORDER BY (issue_date IS NULL) ASC, issue_date DESC'
);
$stmt->execute([$userId]);
Response::success($stmt->fetchAll());
