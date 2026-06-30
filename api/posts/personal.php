<?php

// =====================================================================
// FILE: api/posts/personal.php
// GET ?type=user|company&uuid=<uuid>
// The "personal feed": one author's own posts, newest first.
// Public posts are visible to anyone; 'followers' posts only to the
// owner or to logged-in users who follow that author.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$type = trim($_GET['type'] ?? '');
$uuid = trim($_GET['uuid'] ?? '');

if ($type !== 'user' && $type !== 'company') {
    Response::error("type must be 'user' or 'company'.", 422);
}
if ($uuid === '') {
    Response::error('A uuid is required.', 422);
}

// Resolve uuid -> author id and display info.
if ($type === 'user') {
    $stmt = $pdo->prepare('SELECT id, username AS name, profile_pic AS avatar FROM users WHERE uuid = ? LIMIT 1');
} else {
    $stmt = $pdo->prepare('SELECT id, name, logo AS avatar FROM companies WHERE uuid = ? LIMIT 1');
}
$stmt->execute([$uuid]);
$author = $stmt->fetch();
if (!$author) Response::error('Author not found.', 404);
$authorId = (int) $author['id'];

// Decide whether the viewer may see 'followers'-only posts.
$viewerUserId    = Auth::userId();
$viewerCompanyId = Auth::companyId();
$canSeeFollowerPosts = false;

if ($type === 'user' && $viewerUserId === $authorId) {
    $canSeeFollowerPosts = true;                 // user owner viewing self
} elseif ($type === 'company' && $viewerCompanyId === $authorId) {
    $canSeeFollowerPosts = true;                 // company owner viewing self
} elseif ($viewerUserId !== null) {
    // Logged-in user: do they follow this author?
    $chk = $pdo->prepare(
        'SELECT 1 FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ? LIMIT 1'
    );
    $chk->execute([$viewerUserId, $type, $authorId]);
    $canSeeFollowerPosts = (bool) $chk->fetch();
}

$sql = 'SELECT id, post_type, body, media_url, meta, visibility, created_at
        FROM posts
        WHERE author_type = ? AND author_id = ?';
if (!$canSeeFollowerPosts) {
    $sql .= " AND visibility = 'public'";
}
$sql .= ' ORDER BY created_at DESC LIMIT 50';

$stmt = $pdo->prepare($sql);
$stmt->execute([$type, $authorId]);
$posts = $stmt->fetchAll();

// Decode the JSON meta column for any structured (e.g. cert) posts.
foreach ($posts as &$pp) {
    $pp['meta'] = $pp['meta'] ? json_decode($pp['meta'], true) : null;
}
unset($pp);

Response::success([
    'author' => [
        'type'   => $type,
        'uuid'   => $uuid,
        'name'   => $author['name'],
        'avatar' => $author['avatar'],
    ],
    'posts' => $posts,
]);