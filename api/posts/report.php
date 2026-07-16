<?php

// =====================================================================
// FILE: api/posts/report.php
// GET                          -> { reasons: { key: label, ... } }
// POST { post_id, reason, detail? }  (user or company)
// Files a report against a post. One report per (actor, post);
// re-reporting updates the reason/detail and reopens it.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/PostActions.php';
require_once __DIR__ . '/../../src/RateLimit.php';

// GET is a public helper so the client can build the reason picker.
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    Response::success(['reasons' => PostActions::REASONS]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}
RateLimit::guard('write');

$actor = Social::requireActor();
$in    = Response::input();

$postId = (int) ($in['post_id'] ?? 0);
$reason = trim((string) ($in['reason'] ?? ''));
$detail = isset($in['detail']) ? trim((string) $in['detail']) : null;

if ($postId <= 0)                        Response::error('post_id is required.', 422);
if (!PostActions::isValidReason($reason)) Response::error('Invalid report reason.', 422);
if ($detail !== null && mb_strlen($detail) > 500) {
    Response::error('Details must be 500 characters or fewer.', 422);
}

if (Social::postAuthor($postId) === null) Response::error('Post not found.', 404);

PostActions::report($actor, $postId, $reason, $detail);

Response::success(['post_id' => $postId, 'reported' => true]);
