<?php


// =====================================================================
// FILE: api/profile/skills/list.php
// GET ?uuid=<uuid> (public) | none (own, logged in)
// Returns the user's linked skills, each with id and name.
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

// Join the user's links to the master skill names.
$stmt = $pdo->prepare(
    'SELECT s.id, s.name
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     WHERE us.user_id = ?
     ORDER BY s.name ASC'
);
$stmt->execute([$userId]);
Response::success($stmt->fetchAll());
