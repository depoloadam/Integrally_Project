<?php

// =====================================================================
// FILE: api/admin/resolve-report.php
// POST { post_id, action: 'reviewed'|'dismissed'|'reopen'|'purge' }
// Admin-only. Settles the reports filed against one post.
//
// Resolution is per-post because the queue groups by post: the admin
// judges the post once and every complaint about it settles together.
//
//   reviewed  -> report was valid and acted on
//   dismissed -> report was not actionable
//   reopen    -> put a closed post back in the queue
//   purge     -> delete orphaned report rows for an already-deleted post
//
// Deleting the reported post is NOT handled here; the client calls the
// existing /posts/delete.php (which already has an admin override) and
// then calls back with 'reviewed' so the queue entry settles. That
// keeps one deletion path instead of two that can drift apart.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/PostActions.php';
require_once __DIR__ . '/../../src/Audit.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}
RateLimit::guard('write');

$adminId = Auth::requireAdmin();
$pdo     = Database::conn();
$in      = Response::input();

$postId = (int) ($in['post_id'] ?? 0);
$action = trim((string) ($in['action'] ?? ''));

if ($postId <= 0) Response::error('post_id is required.', 422);

$VALID = ['reviewed', 'dismissed', 'reopen', 'purge'];
if (!in_array($action, $VALID, true)) {
    Response::error('Invalid action.', 422);
}

// The post may legitimately be gone (deleted after it was reported);
// the reports still need clearing, so a missing post is not an error.
$postStmt = $pdo->prepare(
    "SELECT p.id, p.author_type, p.author_id,
            CASE WHEN p.author_type = 'user' THEN u.username ELSE c.name END AS author_name,
            CASE WHEN p.author_type = 'user' THEN u.uuid     ELSE c.uuid END AS author_uuid
     FROM posts p
     LEFT JOIN users u     ON p.author_type COLLATE utf8mb4_unicode_ci = 'user'
                          AND u.id = p.author_id
     LEFT JOIN companies c ON p.author_type COLLATE utf8mb4_unicode_ci = 'company'
                          AND c.id = p.author_id
     WHERE p.id = ? LIMIT 1"
);
$postStmt->execute([$postId]);
$post = $postStmt->fetch() ?: null;

$totalReports = PostActions::reportCount($postId);
if ($totalReports === 0) {
    Response::error('No reports found for this post.', 404);
}

$label = $post
    ? ('post #' . $postId . ' by ' . ($post['author_name'] ?? 'unknown'))
    : ('deleted post #' . $postId);

// ---- purge: only valid once the post itself is gone ------------------
if ($action === 'purge') {
    if ($post !== null) {
        Response::error('This post still exists — resolve or dismiss its reports instead.', 422);
    }
    $removed = PostActions::purgeReports($postId);
    Audit::log(
        $adminId, 'purge_reports', 'post', null, $label,
        ['reports_removed' => $removed]
    );
    Response::success([
        'post_id'  => $postId,
        'action'   => 'purge',
        'affected' => $removed,
    ]);
}

// ---- reopen: pull terminal reports back into the queue ---------------
if ($action === 'reopen') {
    // Reopen from either terminal state, so one call restores a post
    // regardless of how it was closed.
    $changed  = PostActions::resolveReports($postId, 'open', 'reviewed');
    $changed += PostActions::resolveReports($postId, 'open', 'dismissed');

    if ($changed === 0) {
        Response::error('These reports are already open.', 409);
    }

    Audit::log(
        $adminId, 'reopen_reports', 'post',
        $post['author_uuid'] ?? null, $label,
        ['reports_reopened' => $changed]
    );
    Response::success([
        'post_id'  => $postId,
        'action'   => 'reopen',
        'affected' => $changed,
    ]);
}

// ---- reviewed / dismissed --------------------------------------------
// Scoped to currently-open reports: re-resolving a settled post is a
// no-op rather than a silent second write.
$changed = PostActions::resolveReports($postId, $action, 'open');
if ($changed === 0) {
    Response::error('These reports have already been resolved.', 409);
}

Audit::log(
    $adminId,
    $action === 'reviewed' ? 'review_reports' : 'dismiss_reports',
    'post',
    $post['author_uuid'] ?? null,
    $label,
    ['reports_resolved' => $changed, 'post_deleted' => $post === null]
);

Response::success([
    'post_id'  => $postId,
    'action'   => $action,
    'affected' => $changed,
]);
