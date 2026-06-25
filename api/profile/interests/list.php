<?php


// =====================================================================
// FILE: api/profile/interests/list.php
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
    'SELECT i.id, i.name
     FROM user_interests ui
     JOIN interests i ON i.id = ui.interest_id
     WHERE ui.user_id = ?
     ORDER BY i.name ASC'
);
$stmt->execute([$userId]);
Response::success($stmt->fetchAll());