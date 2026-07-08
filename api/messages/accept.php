<?php

// =====================================================================
// FILE: api/messages/accept.php
// POST { conversation_id }
// Accept a pending message request. Only the RECIPIENT (the participant
// who did not start the conversation) can accept.
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

$conv = Messaging::requireParticipant($convId, $actor);

if ($conv['status'] !== 'pending') {
    Response::success(['status' => $conv['status']]); // already accepted: no-op
}

$iStarted = ($conv['initiator_type'] === $actor['type']
             && (int) $conv['initiator_id'] === $actor['id']);
if ($iStarted) {
    Response::error('Only the recipient can accept a message request.', 403);
}

Database::conn()
    ->prepare("UPDATE conversations SET status = 'accepted' WHERE id = ?")
    ->execute([$convId]);

Response::success(['status' => 'accepted']);
