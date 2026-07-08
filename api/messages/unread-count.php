<?php

// =====================================================================
// FILE: api/messages/unread-count.php
// GET — lightweight endpoint for the nav envelope badge poll.
// Returns:
//   unread   = unread messages across ACCEPTED conversations
//   requests = pending incoming message requests
// The badge shows unread + requests.
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

$pdo = Database::conn();

// Unread = messages newer than my read marker, not sent by me,
// not deleted, in accepted conversations only. Muted conversations
// don't ping the nav envelope (they still show unread in the list).
$stmt = $pdo->prepare(
    "SELECT COUNT(*) FROM messages m
     JOIN conversation_participants cp
       ON cp.conversation_id = m.conversation_id
      AND cp.actor_type = ? AND cp.actor_id = ?
     JOIN conversations c ON c.id = m.conversation_id AND c.status = 'accepted'
     WHERE m.id > COALESCE(cp.last_read_message_id, 0)
       AND NOT (m.sender_type = cp.actor_type AND m.sender_id = cp.actor_id)
       AND m.deleted_at IS NULL
       AND cp.muted = 0"
);
$stmt->execute([$actor['type'], $actor['id']]);
$unread = (int) $stmt->fetchColumn();

// Pending requests where I'm the recipient (participant, not initiator).
$stmt = $pdo->prepare(
    "SELECT COUNT(*) FROM conversations c
     JOIN conversation_participants cp
       ON cp.conversation_id = c.id AND cp.actor_type = ? AND cp.actor_id = ?
     WHERE c.status = 'pending'
       AND NOT (c.initiator_type = cp.actor_type AND c.initiator_id = cp.actor_id)"
);
$stmt->execute([$actor['type'], $actor['id']]);
$requests = (int) $stmt->fetchColumn();

Response::success(['unread' => $unread, 'requests' => $requests]);
