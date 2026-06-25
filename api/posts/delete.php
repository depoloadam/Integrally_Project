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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

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
    $stmt = $pdo->prepare('DELETE FROM posts WHERE id = ?');
    $stmt->execute([$id]);
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
