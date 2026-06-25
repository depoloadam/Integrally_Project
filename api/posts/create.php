<?php

// =====================================================================
// FILE: api/posts/create.php
// POST { body*, media_url?, visibility? }
// Authors a post as the current session identity (user or company).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$pdo = Database::conn();

// Determine who is authoring. Prefer a user session; fall back to a
// company session. (A person acting as a company would use the company
// session.) If neither, reject.
$userId    = Auth::userId();
$companyId = Auth::companyId();

if ($userId !== null) {
    $authorType = 'user';
    $authorId   = $userId;
} elseif ($companyId !== null) {
    $authorType = 'company';
    $authorId   = $companyId;
} else {
    Response::error('You must be logged in to post.', 401);
}

$in   = Response::input();
$body = trim($in['body'] ?? '');
$mediaUrl = trim($in['media_url'] ?? '') ?: null;

// Post type: 'text' by default. Whitelist known structured types so a
// client can't invent arbitrary ones. Add new types here as you build them.
$allowedTypes = ['text', 'cert', 'job'];
$postType = $in['post_type'] ?? 'text';
if (!in_array($postType, $allowedTypes, true)) {
    $postType = 'text';
}

// Structured metadata for non-text posts (e.g. cert name/issuer).
// Stored as JSON. Null for plain text posts.
$meta = null;
if (isset($in['meta']) && is_array($in['meta'])) {
    $meta = json_encode($in['meta']);
}

// Validation: a 'text' post needs text or an image. A structured post
// (cert/job) carries its content in meta, so empty body is fine there.
if ($postType === 'text' && $body === '' && $mediaUrl === null) {
    Response::error('A post needs text or an image.', 422);
}
if (mb_strlen($body) > 5000) {
    Response::error('Post is too long (5000 characters max).', 422);
}

$visibility = ($in['visibility'] ?? 'public') === 'followers' ? 'followers' : 'public';

$stmt = $pdo->prepare(
    'INSERT INTO posts (author_type, author_id, post_type, body, media_url, meta, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
$stmt->execute([$authorType, $authorId, $postType, ($body === '' ? null : $body), $mediaUrl, $meta, $visibility]);
$postId = (int) $pdo->lastInsertId();

// --- Fan-out to followers' feeds -------------------------------------
// v1: when a post is created, insert a feed_items row for every user
// who follows this author. This "fan-out on write" makes reading the
// main feed a simple, fast query later. The score defaults to 0 for
// now (chronological); a future algorithm can populate it.
$followers = $pdo->prepare(
    'SELECT follower_id FROM follows WHERE target_type = ? AND target_id = ?'
);
$followers->execute([$authorType, $authorId]);
$followerIds = $followers->fetchAll(PDO::FETCH_COLUMN);

// Also fan out to the author themselves, so a user sees their OWN posts
// in their main feed (not just posts from people they follow). Only
// applies when the author is a user — a company has no personal feed
// of its own to read.
$recipients = array_map('intval', $followerIds);
if ($authorType === 'user') {
    $recipients[] = $authorId;
}
$recipients = array_values(array_unique($recipients));

if ($recipients) {
    $insert = $pdo->prepare(
        'INSERT IGNORE INTO feed_items (user_id, post_id, reason, score)
         VALUES (?, ?, ?, 0)'
    );
    foreach ($recipients as $rid) {
        $reason = ($authorType === 'user' && $rid === $authorId) ? 'self' : 'followed';
        $insert->execute([$rid, $postId, $reason]);
    }
}

Response::success(['id' => $postId, 'author_type' => $authorType], 201);