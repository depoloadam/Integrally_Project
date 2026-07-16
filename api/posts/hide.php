<?php

// =====================================================================
// FILE: api/posts/hide.php
// POST { post_id, hide: true|false }   (user or company)
// Hides / unhides a post from the current actor's feeds. Hidden posts
// are filtered out server-side by PostActions::feedExclusion().
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
$want   = array_key_exists('hide', $in) ? !empty($in['hide']) : true; // default: hide
if ($postId <= 0) Response::error('post_id is required.', 422);

if (Social::postAuthor($postId) === null) Response::error('Post not found.', 404);

if ($want) PostActions::hide($actor, $postId);
else       PostActions::unhide($actor, $postId);

Response::success(['post_id' => $postId, 'hidden' => $want]);
