<?php

// =====================================================================
// FILE: api/messages/mute.php
// POST { conversation_id, muted }
// Toggle mute for the CURRENT actor on one conversation. Muting only
// affects your own participant row: it suppresses message-request /
// new-message notifications for this thread. It does NOT stop delivery
// and the peer is never told. `muted` is coerced to 0/1.
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

// Accept true/false, 1/0, "1"/"0".
$muted = !empty($in['muted']) && $in['muted'] !== '0' ? 1 : 0;

Messaging::requireParticipant($convId, $actor);

$pdo = Database::conn();
$pdo->prepare(
    'UPDATE conversation_participants SET muted = ?
     WHERE conversation_id = ? AND actor_type = ? AND actor_id = ?'
)->execute([$muted, $convId, $actor['type'], $actor['id']]);

Response::success(['muted' => (bool) $muted]);
