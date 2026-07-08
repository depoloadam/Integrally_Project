<?php

// =====================================================================
// FILE: api/messages/send.php
// POST { conversation_id, body }
// Send a message into an existing conversation.
//   - Pending + I started it  -> refused (wait for accept)
//   - Pending + they started  -> replying accepts the request
//   - Blocked either way      -> refused
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

$body = Messaging::cleanBody($in['body'] ?? '');
$conv = Messaging::requireParticipant($convId, $actor);
$pdo  = Database::conn();

// Blocks refuse sending in either direction.
$peerRef = Messaging::otherParticipant($convId, $actor);
if ($peerRef && Messaging::isBlockedEitherWay(
        $actor['type'], $actor['id'], $peerRef['type'], $peerRef['id'])) {
    Response::error('You cannot message this user.', 403);
}

if ($conv['status'] === 'pending') {
    $iStarted = ($conv['initiator_type'] === $actor['type']
                 && (int) $conv['initiator_id'] === $actor['id']);
    if ($iStarted) {
        Response::error('Your message request is still pending. You can send more messages once they accept.', 403);
    }
    // Recipient replying to a request = accepting it.
    $pdo->prepare("UPDATE conversations SET status = 'accepted' WHERE id = ?")
        ->execute([$convId]);
}

$msgId = Messaging::insertMessage($convId, $actor, $body);

Response::success([
    'message_id'      => $msgId,
    'conversation_id' => $convId,
], 201);
