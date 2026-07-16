<?php

// =====================================================================
// FILE: api/posts/save.php
// POST { post_id, save: true|false }   (user or company)
// Bookmarks / un-bookmarks a post for the current actor.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/PostActions.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}
RateLimit::guard('write');

$actor = Social::requireActor();
$in    = Response::input();

$postId = (int) ($in['post_id'] ?? 0);
$want   = !empty($in['save']);
if ($postId <= 0) Response::error('post_id is required.', 422);

if (Social::postAuthor($postId) === null) Response::error('Post not found.', 404);

if ($want) PostActions::save($actor, $postId);
else       PostActions::unsave($actor, $postId);

Response::success(['post_id' => $postId, 'saved' => $want]);
