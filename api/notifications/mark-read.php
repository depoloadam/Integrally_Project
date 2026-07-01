<?php

// =====================================================================
// FILE: api/notifications/mark-read.php
// POST { id }  -> mark one read
// POST { all: true } -> mark all the actor's notifications read
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();
$in    = Response::input();

if (!empty($in['all'])) {
    $stmt = $pdo->prepare(
        'UPDATE notifications SET is_read = 1
         WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
    );
    $stmt->execute([$actor['type'], $actor['id']]);
    Response::success(['marked' => $stmt->rowCount()]);
}

$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('id or all is required.', 422);

// Only the recipient can mark their own notification read.
$stmt = $pdo->prepare(
    'UPDATE notifications SET is_read = 1
     WHERE id = ? AND recipient_type = ? AND recipient_id = ?'
);
$stmt->execute([$id, $actor['type'], $actor['id']]);

Response::success(['marked' => $stmt->rowCount()]);