<?php

// =====================================================================
// FILE: api/messages/start.php
// POST { target_uuid, body }
// Start (or continue) a private conversation with another USER.
//
// Rules:
//   - If the target already follows the sender -> conversation is
//     auto-accepted (no request step).
//   - Otherwise the conversation starts as a PENDING message request:
//     the first message is delivered, but the sender can't send more
//     until the recipient accepts.
//   - If a conversation between the pair already exists:
//       accepted            -> just send the message into it
//       pending (I started) -> error: wait for them to accept
//       pending (they did)  -> replying counts as accepting
//   - Blocks (either direction) refuse everything.
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
RateLimit::guardAll(['message_start', 'message_start_day']);

$actor = Social::requireActor();
Messaging::requireUserActor($actor);

$in  = Response::input();
$pdo = Database::conn();

$body = Messaging::cleanBody($in['body'] ?? '');

// ---- Resolve the target user by uuid --------------------------------
$uuid = trim($in['target_uuid'] ?? '');
if ($uuid === '') Response::error('A target_uuid is required.', 422);

$look = $pdo->prepare('SELECT id FROM users WHERE uuid = ? AND is_active = 1 LIMIT 1');
$look->execute([$uuid]);
$found = $look->fetch();
if (!$found) Response::error('That user does not exist.', 404);
$targetId = (int) $found['id'];

if ($targetId === $actor['id']) {
    Response::error('You cannot message yourself.', 422);
}

// ---- Blocks refuse everything, both directions -----------------------
if (Messaging::isBlockedEitherWay('user', $actor['id'], 'user', $targetId)) {
    Response::error('You cannot message this user.', 403);
}

// ---- Existing conversation between this pair? ------------------------
$existing = Messaging::findConversation('user', $actor['id'], 'user', $targetId);

if ($existing) {
    $convId = (int) $existing['id'];

    if ($existing['status'] === 'pending') {
        $iStarted = ($existing['initiator_type'] === 'user'
                     && (int) $existing['initiator_id'] === $actor['id']);
        if ($iStarted) {
            Response::error('Your message request is still pending. You can send more messages once they accept.', 403);
        }
        // The other side requested me; replying accepts the request.
        $pdo->prepare("UPDATE conversations SET status = 'accepted' WHERE id = ?")
            ->execute([$convId]);
    }

    $msgId = Messaging::insertMessage($convId, $actor, $body);
    Response::success(['conversation_id' => $convId, 'message_id' => $msgId, 'status' => 'accepted']);
}

// ---- New conversation -------------------------------------------------
// Auto-accept when the recipient already follows the sender.
$f = $pdo->prepare(
    "SELECT 1 FROM follows
     WHERE follower_type = 'user' AND follower_id = ?
       AND target_type = 'user' AND target_id = ? LIMIT 1"
);
$f->execute([$targetId, $actor['id']]);
$autoAccept = (bool) $f->fetch();
$status = $autoAccept ? 'accepted' : 'pending';

$pdo->beginTransaction();
try {
    $pdo->prepare(
        "INSERT INTO conversations (status, initiator_type, initiator_id, last_message_at)
         VALUES (?, 'user', ?, NOW())"
    )->execute([$status, $actor['id']]);
    $convId = (int) $pdo->lastInsertId();

    $ins = $pdo->prepare(
        'INSERT INTO conversation_participants (conversation_id, actor_type, actor_id)
         VALUES (?, ?, ?)'
    );
    $ins->execute([$convId, 'user', $actor['id']]);
    $ins->execute([$convId, 'user', $targetId]);

    $msg = $pdo->prepare(
        'INSERT INTO messages (conversation_id, sender_type, sender_id, body)
         VALUES (?, ?, ?, ?)'
    );
    $msg->execute([$convId, 'user', $actor['id'], $body]);
    $msgId = (int) $pdo->lastInsertId();

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    Response::error('Could not start the conversation.', 500);
}

// Bell notification only for message REQUESTS — regular message traffic
// is surfaced by the envelope badge, not the bell (avoids double-noise).
if (!$autoAccept) {
    Social::notify('user', $targetId, 'user', $actor['id'], 'message_request');
}

Response::success([
    'conversation_id' => $convId,
    'message_id'      => $msgId,
    'status'          => $status,
], 201);
