<?php

// =====================================================================
// FILE: api/messages/delete.php
// POST { message_id }
// Soft-delete one of YOUR OWN messages. The row is kept (so the thread
// keeps its shape and ids stay stable) but deleted_at is set, and the
// body is hidden on read for everyone. You can only delete your own
// messages, and only inside a conversation you're part of.
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

$in    = Response::input();
$msgId = (int) ($in['message_id'] ?? 0);
if ($msgId <= 0) Response::error('A message id is required.', 422);

$pdo = Database::conn();

// Load the message + confirm ownership.
$stmt = $pdo->prepare(
    'SELECT id, conversation_id, sender_type, sender_id, deleted_at
     FROM messages WHERE id = ? LIMIT 1'
);
$stmt->execute([$msgId]);
$msg = $stmt->fetch();
if (!$msg) Response::error('Message not found.', 404);

// Must be a participant of the conversation this message belongs to.
Messaging::requireParticipant((int) $msg['conversation_id'], $actor);

// Can only delete your own messages.
$mine = ($msg['sender_type'] === $actor['type'] && (int) $msg['sender_id'] === $actor['id']);
if (!$mine) Response::error('You can only delete your own messages.', 403);

// Idempotent: already-deleted is a no-op success.
if ($msg['deleted_at'] === null) {
    $pdo->prepare('UPDATE messages SET deleted_at = NOW() WHERE id = ?')
        ->execute([$msgId]);
}

Response::success(['message_id' => $msgId, 'deleted' => true]);
