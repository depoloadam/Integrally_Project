<?php

// =====================================================================
// FILE: api/messages/decline.php
// POST { conversation_id }
// Decline a pending message request. Only the RECIPIENT can decline.
// Declining deletes the conversation, its participants, and its
// messages entirely (transactional) — the sender can request again
// later unless the recipient blocks them (Part 2 UI).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/Messaging.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$actor = Social::requireActor();
Messaging::requireUserActor($actor);

$in     = Response::input();
$convId = (int) ($in['conversation_id'] ?? 0);
if ($convId <= 0) Response::error('A conversation id is required.', 422);

$conv = Messaging::requireParticipant($convId, $actor);

if ($conv['status'] !== 'pending') {
    Response::error('Only pending requests can be declined.', 422);
}

$iStarted = ($conv['initiator_type'] === $actor['type']
             && (int) $conv['initiator_id'] === $actor['id']);
if ($iStarted) {
    Response::error('Only the recipient can decline a message request.', 403);
}

$pdo = Database::conn();
$pdo->beginTransaction();
try {
    $pdo->prepare('DELETE FROM messages WHERE conversation_id = ?')->execute([$convId]);
    $pdo->prepare('DELETE FROM conversation_participants WHERE conversation_id = ?')->execute([$convId]);
    $pdo->prepare('DELETE FROM conversations WHERE id = ?')->execute([$convId]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    Response::error('Could not decline the request.', 500);
}

Response::success(['declined' => true]);
