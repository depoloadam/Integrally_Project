<?php

// =====================================================================
// FILE: api/messages/thread.php
// GET ?id=<conversation_id>[&before_id=<message_id>]
// Messages for one conversation (must be a participant), oldest-first,
// paginated backwards 50 at a time via before_id. Also returns the
// conversation meta (status, who started it, the peer) and the peer's
// last_read_message_id so the client can draw "Seen" receipts.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/Messaging.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
Messaging::requireUserActor($actor);

$convId = (int) ($_GET['id'] ?? 0);
if ($convId <= 0) Response::error('A conversation id is required.', 422);

$conv = Messaging::requireParticipant($convId, $actor);
$pdo  = Database::conn();

// Peer + their read marker (for receipts).
$peerRef = Messaging::otherParticipant($convId, $actor);
$peer = $peerRef ? Social::actorInfo($peerRef['type'], $peerRef['id']) : null;

$peerLastRead = 0;
if ($peerRef) {
    $stmt = $pdo->prepare(
        'SELECT last_read_message_id FROM conversation_participants
         WHERE conversation_id = ? AND actor_type = ? AND actor_id = ? LIMIT 1'
    );
    $stmt->execute([$convId, $peerRef['type'], $peerRef['id']]);
    $peerLastRead = (int) ($stmt->fetchColumn() ?: 0);
}

// Blocked either way? Thread stays readable, but tell the client so it
// can disable the composer. Also report whether *I* am the blocker, so
// the UI can show "Unblock" (mine to lift) vs a passive blocked notice.
$blocked  = false;
$iBlocked = false;
if ($peerRef) {
    $blocked = Messaging::isBlockedEitherWay(
        $actor['type'], $actor['id'], $peerRef['type'], $peerRef['id']);
    $st = $pdo->prepare(
        'SELECT 1 FROM blocks
         WHERE blocker_type = ? AND blocker_id = ?
           AND blocked_type = ? AND blocked_id = ? LIMIT 1'
    );
    $st->execute([$actor['type'], $actor['id'], $peerRef['type'], $peerRef['id']]);
    $iBlocked = (bool) $st->fetch();
}

// My own mute state for this conversation.
$st = $pdo->prepare(
    'SELECT muted FROM conversation_participants
     WHERE conversation_id = ? AND actor_type = ? AND actor_id = ? LIMIT 1'
);
$st->execute([$convId, $actor['type'], $actor['id']]);
$muted = (bool) $st->fetchColumn();

// ---- Messages, newest page first, returned oldest-first --------------
$beforeId = (int) ($_GET['before_id'] ?? 0);
if ($beforeId > 0) {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, sender_id, body, created_at, deleted_at
         FROM messages WHERE conversation_id = ? AND id < ?
         ORDER BY id DESC LIMIT 50'
    );
    $stmt->execute([$convId, $beforeId]);
} else {
    $stmt = $pdo->prepare(
        'SELECT id, sender_type, sender_id, body, created_at, deleted_at
         FROM messages WHERE conversation_id = ?
         ORDER BY id DESC LIMIT 50'
    );
    $stmt->execute([$convId]);
}
$page = array_reverse($stmt->fetchAll());

$messages = [];
foreach ($page as $m) {
    $deleted = $m['deleted_at'] !== null;
    $messages[] = [
        'id'         => (int) $m['id'],
        'mine'       => ($m['sender_type'] === $actor['type'] && (int) $m['sender_id'] === $actor['id']),
        'body'       => $deleted ? null : $m['body'],
        'deleted'    => $deleted,
        'created_at' => $m['created_at'],
    ];
}

$iStarted = ($conv['initiator_type'] === $actor['type'] && (int) $conv['initiator_id'] === $actor['id']);

Response::success([
    'conversation' => [
        'id'        => $convId,
        'status'    => $conv['status'],
        'i_started' => $iStarted,
        'peer'      => $peer,
        'blocked'   => $blocked,
        'i_blocked' => $iBlocked,
        'muted'     => $muted,
    ],
    'messages'            => $messages,
    'has_more'            => count($page) === 50,
    'peer_last_read_id'   => $peerLastRead,
]);
