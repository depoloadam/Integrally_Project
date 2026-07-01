<?php

// =====================================================================
// FILE: api/posts/comment-delete.php
// POST { id }   (user or company)
// Deletes a comment if the actor owns it, OR the actor owns the post,
// OR the actor is an admin user.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();
$in    = Response::input();

$commentId = (int) ($in['id'] ?? 0);
if ($commentId <= 0) Response::error('id is required.', 422);

$stmt = $pdo->prepare(
    'SELECT pc.actor_type, pc.actor_id, pc.post_id, p.author_type, p.author_id
     FROM post_comments pc JOIN posts p ON p.id = pc.post_id
     WHERE pc.id = ? LIMIT 1'
);
$stmt->execute([$commentId]);
$c = $stmt->fetch();
if (!$c) Response::error('Comment not found.', 404);

$ownsComment = ($actor['type'] === $c['actor_type'] && $actor['id'] === (int) $c['actor_id']);
$ownsPost    = ($actor['type'] === $c['author_type'] && $actor['id'] === (int) $c['author_id']);
$isAdmin     = ($actor['type'] === 'user' && Auth::userId() !== null && Auth::isAdmin());

if (!$ownsComment && !$ownsPost && !$isAdmin) {
    Response::error('You cannot delete this comment.', 403);
}

$del = $pdo->prepare('DELETE FROM post_comments WHERE id = ?');
$del->execute([$commentId]);

Response::success(['deleted' => true, 'id' => $commentId]);