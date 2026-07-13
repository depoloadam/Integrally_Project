<?php

// =====================================================================
// FILE: api/posts/delete.php
// POST { id* }
// Deletes a post owned by the current session identity. Cascades to
// feed_items via the schema's ON DELETE CASCADE.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$pdo       = Database::conn();
$userId    = Auth::userId();
$companyId = Auth::companyId();

if ($userId !== null) {
    $authorType = 'user';  $authorId = $userId;
} elseif ($companyId !== null) {
    $authorType = 'company'; $authorId = $companyId;
} else {
    Response::error('Authentication required.', 401);
}

$in = Response::input();
$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('A valid post id is required.', 422);

// Admins can delete ANY post; regular users only their own.
if (Auth::isAdmin()) {
    // Snapshot the post BEFORE deleting so moderation actions can be
    // audited. Only deleting SOMEONE ELSE'S post is a moderation act;
    // an admin removing their own post is a normal delete (no audit).
    $snap = $pdo->prepare('SELECT author_type, author_id, body FROM posts WHERE id = ? LIMIT 1');
    $snap->execute([$id]);
    $post = $snap->fetch();

    $stmt = $pdo->prepare('DELETE FROM posts WHERE id = ?');
    $stmt->execute([$id]);

    $isOwnPost = $post
        && $post['author_type'] === 'user'
        && (int) $post['author_id'] === $userId;
    if ($post && !$isOwnPost && $stmt->rowCount() > 0) {
        require_once __DIR__ . '/../../src/Audit.php';
        $snippet = trim(mb_substr(strip_tags((string) $post['body']), 0, 80));
        $label   = $snippet !== '' ? '"' . $snippet . '"' : ('post #' . $id);
        Audit::log($userId, 'delete_post', 'post', null, $label,
            ['post_id' => $id, 'author_type' => $post['author_type'], 'author_id' => (int) $post['author_id']]);
    }
} else {
    // Delete only if this session owns the post.
    $stmt = $pdo->prepare(
        'DELETE FROM posts WHERE id = ? AND author_type = ? AND author_id = ?'
    );
    $stmt->execute([$id, $authorType, $authorId]);
}

if ($stmt->rowCount() === 0) {
    Response::error('Post not found.', 404);
}
Response::success(['deleted' => $id]);
