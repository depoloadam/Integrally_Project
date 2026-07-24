<?php

// =====================================================================
// FILE: api/posts/comment-list.php
// GET ?post_id=   (public; marks 'mine' if signed in)
// Lists comments for a post, oldest first, with author display info.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo = Database::conn();
$postId = (int) ($_GET['post_id'] ?? 0);
if ($postId <= 0) Response::error('post_id is required.', 422);

$me = Social::currentActor();

$stmt = $pdo->prepare(
    'SELECT id, actor_type, actor_id, body, created_at
     FROM post_comments WHERE post_id = ? ORDER BY created_at ASC'
);
$stmt->execute([$postId]);
$rows = $stmt->fetchAll();

// Mention links are rendered server-side: comment bodies are plain text
// and the client injects body_html directly, so escaping happens here.
require_once __DIR__ . '/../../src/Mentions.php';
$mentionMap = Mentions::forComments(array_map(fn($c) => (int) $c['id'], $rows));

$out = [];
foreach ($rows as $c) {
    $mine = $me !== null && $me['type'] === $c['actor_type'] && (int) $me['id'] === (int) $c['actor_id'];
    $out[] = [
        'id'         => (int) $c['id'],
        'body'       => $c['body'],
        'body_html'  => Mentions::linkPlain($c['body'], $mentionMap[(int) $c['id']] ?? []),
        'created_at' => $c['created_at'],
        'author'     => Social::actorInfo($c['actor_type'], (int) $c['actor_id']),
        'mine'       => $mine,
    ];
}

Response::success(['comments' => $out, 'count' => count($out)]);