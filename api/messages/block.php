<?php

// =====================================================================
// FILE: api/messages/block.php
// POST { conversation_id }
// Block the OTHER participant of a conversation. Once blocked, neither
// side can send messages (send.php refuses in both directions). The
// conversation and its history remain; only sending is disabled.
// Idempotent — blocking an already-blocked peer is a no-op success.
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
    'INSERT IGNORE INTO blocks (blocker_type, blocker_id, blocked_type, blocked_id)
     VALUES (?, ?, ?, ?)'
)->execute([$actor['type'], $actor['id'], $peer['type'], $peer['id']]);

Response::success(['blocked' => true]);
