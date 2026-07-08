<?php

// =====================================================================
// FILE: api/messages/conversations.php
// GET — every conversation the current actor is part of, newest
// activity first. Each row carries the peer's display info, a preview
// of the last message, an unread count, and the request state so the
// client can split the list into Requests / Inbox.
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

// All conversations I'm in, with my own participant row (for unread math).
$stmt = $pdo->prepare(
    'SELECT c.id, c.status, c.initiator_type, c.initiator_id,
            c.last_message_at, c.created_at,
            cp.last_read_message_id, cp.muted
     FROM conversations c
     JOIN conversation_participants cp
       ON cp.conversation_id = c.id AND cp.actor_type = ? AND cp.actor_id = ?
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT 200'
);
$stmt->execute([$actor['type'], $actor['id']]);
$rows = $stmt->fetchAll();

$peerStmt = $pdo->prepare(
    'SELECT actor_type, actor_id FROM conversation_participants
     WHERE conversation_id = ? AND NOT (actor_type = ? AND actor_id = ?) LIMIT 1'
);
$lastStmt = $pdo->prepare(
    'SELECT id, sender_type, sender_id, body, created_at, deleted_at
     FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'
);
$unreadStmt = $pdo->prepare(
    'SELECT COUNT(*) FROM messages
     WHERE conversation_id = ? AND id > ?
       AND NOT (sender_type = ? AND sender_id = ?)
       AND deleted_at IS NULL'
);

$out = [];
foreach ($rows as $r) {
    $convId = (int) $r['id'];

    $peerStmt->execute([$convId, $actor['type'], $actor['id']]);
    $peer = $peerStmt->fetch();
    if (!$peer) continue; // defensive: malformed conversation

    $peerInfo = Social::actorInfo($peer['actor_type'], (int) $peer['actor_id']);

    $lastStmt->execute([$convId]);
    $last = $lastStmt->fetch();
    $preview = null;
    if ($last) {
        $mine = ($last['sender_type'] === $actor['type'] && (int) $last['sender_id'] === $actor['id']);
        $text = $last['deleted_at'] !== null
            ? 'Message deleted'
            : mb_substr($last['body'], 0, 80);
        $preview = [
            'text'       => $text,
            'mine'       => $mine,
            'deleted'    => $last['deleted_at'] !== null,
            'created_at' => $last['created_at'],
        ];
    }

    $unreadStmt->execute([
        $convId,
        (int) ($r['last_read_message_id'] ?? 0),
        $actor['type'], $actor['id'],
    ]);
    $unread = (int) $unreadStmt->fetchColumn();

    $iStarted = ($r['initiator_type'] === $actor['type'] && (int) $r['initiator_id'] === $actor['id']);

    $out[] = [
        'id'              => $convId,
        'status'          => $r['status'],
        'i_started'       => $iStarted,
        'peer'            => $peerInfo,
        'last_message'    => $preview,
        'unread'          => $unread,
        'muted'           => (bool) $r['muted'],
        'last_message_at' => $r['last_message_at'] ?: $r['created_at'],
    ];
}

Response::success(['conversations' => $out]);
