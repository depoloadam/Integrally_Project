<?php

// =====================================================================
// FILE: api/notifications/list.php
// GET ?limit=&unread_count_only=
// Returns the current actor's notifications (newest first) plus the
// unread count. ?unread_count_only=1 returns just the count (cheap,
// for polling the bell badge).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();

// Unread count (always computed).
$uc = $pdo->prepare(
    'SELECT COUNT(*) FROM notifications
     WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
);
$uc->execute([$actor['type'], $actor['id']]);
$unread = (int) $uc->fetchColumn();

if (!empty($_GET['unread_count_only'])) {
    Response::success(['unread' => $unread]);
}

$limit = (int) ($_GET['limit'] ?? 20);
if ($limit <= 0)  $limit = 20;
if ($limit > 100) $limit = 100;

$stmt = $pdo->prepare(
    'SELECT id, actor_type, actor_id, type, post_id, comment_id, is_read, created_at
     FROM notifications
     WHERE recipient_type = ? AND recipient_id = ?
     ORDER BY created_at DESC
     LIMIT ?'
);
$stmt->bindValue(1, $actor['type']);
$stmt->bindValue(2, $actor['id'], PDO::PARAM_INT);
$stmt->bindValue(3, $limit, PDO::PARAM_INT);
$stmt->execute();

// Cache post snippets so we don't re-query per row.
$postCache = [];
$getPostInfo = function (?int $postId) use ($pdo, &$postCache) {
    if (!$postId) return null;
    if (isset($postCache[$postId])) return $postCache[$postId];
    $s = $pdo->prepare('SELECT id, body, author_type, author_id FROM posts WHERE id = ? LIMIT 1');
    $s->execute([$postId]);
    $p = $s->fetch();
    if (!$p) return $postCache[$postId] = null;
    // Plain-text snippet of the body.
    $text = trim(preg_replace('/\s+/', ' ', strip_tags((string) $p['body'])));
    if (mb_strlen($text) > 80) $text = mb_substr($text, 0, 80) . '…';
    return $postCache[$postId] = ['id' => (int) $p['id'], 'snippet' => $text];
};

// For message_request notifications: resolve the conversation between
// the actor and me plus a snippet of its first message, at read time.
// No stored reference needed — if the request was declined (conversation
// deleted), this returns null and the notification renders without it.
require_once __DIR__ . '/../../src/Messaging.php';
$msgCache = [];
$getMessageInfo = function (string $actorType, int $actorId) use ($pdo, $actor, &$msgCache) {
    $key = $actorType . ':' . $actorId;
    if (array_key_exists($key, $msgCache)) return $msgCache[$key];
    $conv = Messaging::findConversation($actorType, $actorId, $actor['type'], $actor['id']);
    if (!$conv) return $msgCache[$key] = null;
    $s = $pdo->prepare(
        'SELECT body FROM messages
         WHERE conversation_id = ? AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1'
    );
    $s->execute([(int) $conv['id']]);
    $body = $s->fetchColumn();
    $text = $body !== false ? trim(preg_replace('/\s+/', ' ', (string) $body)) : '';
    if (mb_strlen($text) > 80) $text = mb_substr($text, 0, 80) . '…';
    return $msgCache[$key] = [
        'conversation_id' => (int) $conv['id'],
        'snippet'         => $text !== '' ? $text : null,
        'status'          => $conv['status'],
    ];
};

$out = [];
foreach ($stmt->fetchAll() as $n) {
    $out[] = [
        'id'         => (int) $n['id'],
        'type'       => $n['type'],
        // Exposed so the client can distinguish "mentioned you in a post"
        // from "...in a comment" without a second lookup.
        'comment_id' => $n['comment_id'] !== null ? (int) $n['comment_id'] : null,
        'is_read'    => (int) $n['is_read'] === 1,
        'created_at' => $n['created_at'],
        'actor'      => Social::actorInfo($n['actor_type'], (int) $n['actor_id']),
        'post'       => $getPostInfo($n['post_id'] !== null ? (int) $n['post_id'] : null),
        'message'    => $n['type'] === 'message_request'
                          ? $getMessageInfo($n['actor_type'], (int) $n['actor_id'])
                          : null,
    ];
}

Response::success(['notifications' => $out, 'unread' => $unread]);