<?php

// =====================================================================
// FILE: api/posts/like.php
// POST { post_id, like: true|false }  (user or company)
// Toggles the current actor's like on a post. Creates a 'like'
// notification for the post author (unless liking your own post).
// Returns the new like count and whether the actor now likes it.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$actor = Social::requireActor();
$pdo   = Database::conn();
$in    = Response::input();

$postId = (int) ($in['post_id'] ?? 0);
$want   = !empty($in['like']);
if ($postId <= 0) Response::error('post_id is required.', 422);

// Confirm the post exists (and grab author for notifications).
$author = Social::postAuthor($postId);
if ($author === null) Response::error('Post not found.', 404);

if ($want) {
    // Insert ignore (unique key prevents duplicates).
    $stmt = $pdo->prepare(
        'INSERT IGNORE INTO post_likes (post_id, actor_type, actor_id) VALUES (?, ?, ?)'
    );
    $stmt->execute([$postId, $actor['type'], $actor['id']]);
    // Only notify if this was a NEW like (rowCount > 0).
    if ($stmt->rowCount() > 0) {
        Social::notify($author['type'], $author['id'], $actor['type'], $actor['id'], 'like', $postId);
    }
} else {
    $stmt = $pdo->prepare(
        'DELETE FROM post_likes WHERE post_id = ? AND actor_type = ? AND actor_id = ?'
    );
    $stmt->execute([$postId, $actor['type'], $actor['id']]);
    // Remove any like-notification from this actor for this post (tidy).
    $del = $pdo->prepare(
        'DELETE FROM notifications
         WHERE type = "like" AND post_id = ? AND actor_type = ? AND actor_id = ?'
    );
    $del->execute([$postId, $actor['type'], $actor['id']]);
}

// Return fresh count + state.
$cnt = $pdo->prepare('SELECT COUNT(*) FROM post_likes WHERE post_id = ?');
$cnt->execute([$postId]);
$count = (int) $cnt->fetchColumn();

Response::success(['post_id' => $postId, 'likes' => $count, 'liked' => $want]);