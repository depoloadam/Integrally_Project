<?php

// =====================================================================
// FILE: api/feed/main.php
// GET ?before=<id>   (optional, for pagination)
// The MAIN FEED (v1): recent posts from authors the logged-in user
// follows, newest first. Reads from feed_items (populated on write),
// joined to posts, with each post's author info resolved.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/PostActions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();
$actor  = ['type' => 'user', 'id' => $userId];

// Simple keyset pagination: pass ?before=<feed_item_id> to get older.
$before = (int) ($_GET['before'] ?? 0);
$limit  = 20;

// Sort mode (default newest). 'relevance' on the main feed means
// followed-authors first, then newest — self posts sink below the
// people you actually follow. Other keys defer to PostActions::orderBy.
$sort = trim((string) ($_GET['sort'] ?? 'newest'));
if (!PostActions::isValidSort($sort)) $sort = 'newest';

// Exclude posts this user has hidden or whose author they've muted.
$excl = PostActions::feedExclusion($actor, 'p');

$sql = '
    SELECT fi.id AS feed_id, fi.reason, fi.score,
           p.id AS post_id, p.author_type, p.author_id,
           p.post_type, p.body, p.media_url, p.meta, p.created_at
    FROM feed_items fi
    JOIN posts p ON p.id = fi.post_id
    WHERE fi.user_id = ?';
$params = [$userId];
if ($before > 0) {
    $sql .= ' AND fi.id < ?';
    $params[] = $before;
}
$sql   .= $excl['sql'];
$params = array_merge($params, $excl['params']);

if ($sort === 'relevance') {
    // followed (0) before self (1), then newest within each bucket.
    $sql .= " ORDER BY (fi.reason = 'self') ASC, p.created_at DESC, fi.id DESC";
} else {
    $sql .= ' ORDER BY ' . PostActions::orderBy($sort, 'p');
}
$sql .= ' LIMIT ' . (int) $limit;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

// Resolve author display info per post (small N per page).
$userStmt    = $pdo->prepare('SELECT uuid, username, profile_pic FROM users WHERE id = ? LIMIT 1');
$companyStmt = $pdo->prepare('SELECT uuid, name, logo FROM companies WHERE id = ? LIMIT 1');

$feed = [];
$lastFeedId = null;
foreach ($rows as $r) {
    $author = ['type' => $r['author_type']];
    if ($r['author_type'] === 'user') {
        $userStmt->execute([$r['author_id']]);
        if ($a = $userStmt->fetch()) {
            $author['uuid']   = $a['uuid'];
            $author['name']   = $a['username'];
            $author['avatar'] = $a['profile_pic'];
        }
    } else {
        $companyStmt->execute([$r['author_id']]);
        if ($a = $companyStmt->fetch()) {
            $author['uuid']   = $a['uuid'];
            $author['name']   = $a['name'];
            $author['avatar'] = $a['logo'];
        }
    }

    $feed[] = [
        'post_id'    => (int) $r['post_id'],
        'post_type'  => $r['post_type'],
        'body'       => $r['body'],
        'media_url'  => $r['media_url'],
        'meta'       => $r['meta'] ? json_decode($r['meta'], true) : null,
        'created_at' => $r['created_at'],
        'reason'     => $r['reason'],
        'author'     => $author,
    ];
    $lastFeedId = (int) $r['feed_id'];
}

// Decorate with like/comment counts + viewer's like state.
require_once __DIR__ . '/../../src/Social.php';
$ids = array_map(fn($i) => $i['post_id'], $feed);
$eng = Social::engagement($ids, $actor);
$sav = PostActions::savedMap($actor, $ids);
foreach ($feed as &$it) {
    $e = $eng[$it['post_id']] ?? ['likes' => 0, 'comments' => 0, 'liked' => false];
    $it['likes'] = $e['likes']; $it['comments'] = $e['comments']; $it['liked'] = $e['liked'];
    $it['saved'] = isset($sav[$it['post_id']]);
}
unset($it);

Response::success([
    'items'       => $feed,
    'next_before' => $lastFeedId,   // pass back as ?before= for next page
]);