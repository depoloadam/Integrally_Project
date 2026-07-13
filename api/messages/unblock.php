<?php

// =====================================================================
// FILE: api/messages/unblock.php
// POST { conversation_id }
// Remove a block YOU placed on the other participant. Only removes the
// block in your direction — if they also blocked you, that stands and
// messaging remains disabled. Idempotent.
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

Messaging::requireParticipant($convId, $actor);

$peer = Messaging::otherParticipant($convId, $actor);
if (!$peer) Response::error('This conversation has no other participant.', 404);

$pdo = Database::conn();
$pdo->prepare(
    'DELETE FROM blocks
     WHERE blocker_type = ? AND blocker_id = ?
       AND blocked_type = ? AND blocked_id = ?'
)->execute([$actor['type'], $actor['id'], $peer['type'], $peer['id']]);

Response::success(['blocked' => false]);
