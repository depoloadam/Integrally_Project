<?php

// =====================================================================
// FILE: api/posts/comment-add.php
// POST { post_id, body }  (user or company)
// Adds a comment, notifies the post author. Returns the new comment.
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
$body   = trim($in['body'] ?? '');
if ($postId <= 0) Response::error('post_id is required.', 422);
if ($body === '') Response::error('Comment cannot be empty.', 422);
if (mb_strlen($body) > 2000) Response::error('Comment is too long (2000 characters max).', 422);

$author = Social::postAuthor($postId);
if ($author === null) Response::error('Post not found.', 404);

$stmt = $pdo->prepare(
    'INSERT INTO post_comments (post_id, actor_type, actor_id, body) VALUES (?, ?, ?, ?)'
);
$stmt->execute([$postId, $actor['type'], $actor['id'], $body]);
$commentId = (int) $pdo->lastInsertId();

// Notify the post author (skipped automatically if commenting on own post).
Social::notify($author['type'], $author['id'], $actor['type'], $actor['id'], 'comment', $postId, $commentId);

$info = Social::actorInfo($actor['type'], $actor['id']);
Response::success([
    'id'         => $commentId,
    'post_id'    => $postId,
    'body'       => $body,
    'created_at' => date('Y-m-d H:i:s'),
    'author'     => $info,
    'mine'       => true,
], 201);