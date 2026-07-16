<?php

// =====================================================================
// FILE: api/posts/mute-author.php
// POST { post_id, mute: true|false }   (user or company)
// "Show fewer posts like this": mutes the AUTHOR of the given post for
// the current actor. Resolved from post_id so the client never has to
// know the author's internal id. Every post by a muted author is
// filtered from the actor's feeds (PostActions::feedExclusion()).
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
$want   = array_key_exists('mute', $in) ? !empty($in['mute']) : true; // default: mute
if ($postId <= 0) Response::error('post_id is required.', 422);

$author = Social::postAuthor($postId);   // ['type' => ..., 'id' => ...]
if ($author === null) Response::error('Post not found.', 404);

// Muting yourself is a no-op that would hide your own posts — refuse it.
if ($author['type'] === $actor['type'] && (int) $author['id'] === (int) $actor['id']) {
    Response::error("You can't mute yourself.", 422);
}

if ($want) PostActions::muteAuthor($actor, $author['type'], (int) $author['id']);
else       PostActions::unmuteAuthor($actor, $author['type'], (int) $author['id']);

Response::success(['muted' => $want]);
