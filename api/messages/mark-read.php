<?php

// =====================================================================
// FILE: api/messages/mark-read.php
// POST { conversation_id }
// Marks everything in the conversation as read for the current actor
// (sets last_read_message_id to the newest message id). Called when
// the thread is opened / refreshed while open.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/Messaging.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
Messaging::requireUserActor($actor);

$in     = Response::input();
$convId = (int) ($in['conversation_id'] ?? 0);
if ($convId <= 0) Response::error('A conversation id is required.', 422);

Messaging::requireParticipant($convId, $actor);
$pdo = Database::conn();

$stmt = $pdo->prepare('SELECT MAX(id) FROM messages WHERE conversation_id = ?');
$stmt->execute([$convId]);
$maxId = (int) ($stmt->fetchColumn() ?: 0);

if ($maxId > 0) {
    $pdo->prepare(
        'UPDATE conversation_participants
         SET last_read_message_id = ?
         WHERE conversation_id = ? AND actor_type = ? AND actor_id = ?'
    )->execute([$maxId, $convId, $actor['type'], $actor['id']]);
}

Response::success(['last_read_message_id' => $maxId]);
