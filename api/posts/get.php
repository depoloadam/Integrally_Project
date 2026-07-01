<?php

// =====================================================================
// FILE: api/posts/get.php
// GET ?id=<post_id>
// Returns a single post with author info and engagement (likes/comments/
// liked), shaped like a feed item so the client can reuse renderPost().
// Respects visibility: 'followers' posts are visible only to the author
// or a follower.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo = Database::conn();
$postId = (int) ($_GET['id'] ?? 0);
if ($postId <= 0) Response::error('id is required.', 422);

$stmt = $pdo->prepare(
    'SELECT id, author_type, author_id, post_type, body, media_url, meta, visibility, created_at
     FROM posts WHERE id = ? LIMIT 1'
);
$stmt->execute([$postId]);
$p = $stmt->fetch();
if (!$p) Response::error('Post not found.', 404);

// Visibility check for followers-only posts.
if ($p['visibility'] === 'followers') {
    $me = Social::currentActor();
    $allowed = false;
    if ($me !== null) {
        // Author viewing own post.
        if ($me['type'] === $p['author_type'] && (int) $me['id'] === (int) $p['author_id']) {
            $allowed = true;
        } elseif ($me['type'] === 'user') {
            // A following user may see it.
            $chk = $pdo->prepare(
                'SELECT 1 FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ? LIMIT 1'
            );
            $chk->execute([$me['id'], $p['author_type'], $p['author_id']]);
            $allowed = (bool) $chk->fetch();
        }
    }
    if (!$allowed) Response::error('This post is not available.', 403);
}

$author = Social::actorInfo($p['author_type'], (int) $p['author_id']);
// Feed cards use author.name as the display name; for users show full name
// if present, else username (matches the feed's author shape).
$authorForCard = [
    'type'   => $author['type'],
    'uuid'   => $author['uuid'],
    'name'   => $author['type'] === 'user'
        ? ($author['name'])          // username; renderPost shows this
        : $author['name'],
    'avatar' => $author['avatar'],
];

$eng = Social::engagement([$postId], Social::currentActor());
$e = $eng[$postId] ?? ['likes' => 0, 'comments' => 0, 'liked' => false];

Response::success([
    'post_id'    => (int) $p['id'],
    'post_type'  => $p['post_type'],
    'body'       => $p['body'],
    'media_url'  => $p['media_url'],
    'meta'       => $p['meta'] ? json_decode($p['meta'], true) : null,
    'created_at' => $p['created_at'],
    'author'     => $authorForCard,
    'likes'      => $e['likes'],
    'comments'   => $e['comments'],
    'liked'      => $e['liked'],
]);