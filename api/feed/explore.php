<?php

// =====================================================================
// FILE: api/feed/explore.php
// GET ?before=<post_id>  (optional, for pagination)
// EXPLORE: recent PUBLIC posts from across Integrally, regardless of
// who you follow. This is the "discover content outside your feed" tab.
//
// v1 ordering: newest public posts first. Excludes the viewer's own
// posts (those live in the main feed) and 'followers'-only posts.
// A future version can make this algorithmic (trending, interest-based).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo    = Database::conn();
$userId = Auth::userId();   // may be null; explore is viewable logged-out too
$before = (int) ($_GET['before'] ?? 0);
$limit  = 20;

// Only public posts. Optionally page with ?before=<post_id>.
$sql = "
    SELECT p.id AS post_id, p.author_type, p.author_id,
           p.post_type, p.body, p.media_url, p.meta, p.created_at
    FROM posts p
    WHERE p.visibility = 'public'";
$params = [];

// Don't show the viewer their own posts in explore (they're in main).
if ($userId !== null) {
    $sql .= " AND NOT (p.author_type = 'user' AND p.author_id = ?)";
    $params[] = $userId;
}
if ($before > 0) {
    $sql .= ' AND p.id < ?';
    $params[] = $before;
}
$sql .= ' ORDER BY p.created_at DESC, p.id DESC LIMIT ' . (int) $limit;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$userStmt    = $pdo->prepare('SELECT uuid, username, profile_pic FROM users WHERE id = ? LIMIT 1');
$companyStmt = $pdo->prepare('SELECT uuid, name, logo FROM companies WHERE id = ? LIMIT 1');

$out = [];
$lastId = null;
foreach ($rows as $r) {
    $author = ['type' => $r['author_type']];
    if ($r['author_type'] === 'user') {
        $userStmt->execute([$r['author_id']]);
        if ($a = $userStmt->fetch()) {
            $author['uuid'] = $a['uuid']; $author['name'] = $a['username']; $author['avatar'] = $a['profile_pic'];
        }
    } else {
        $companyStmt->execute([$r['author_id']]);
        if ($a = $companyStmt->fetch()) {
            $author['uuid'] = $a['uuid']; $author['name'] = $a['name']; $author['avatar'] = $a['logo'];
        }
    }
    $out[] = [
        'post_id'    => (int) $r['post_id'],
        'post_type'  => $r['post_type'],
        'body'       => $r['body'],
        'media_url'  => $r['media_url'],
        'meta'       => $r['meta'] ? json_decode($r['meta'], true) : null,
        'created_at' => $r['created_at'],
        'author'     => $author,
    ];
    $lastId = (int) $r['post_id'];
}

// Decorate with like/comment counts + viewer's like state.
require_once __DIR__ . '/../../src/Social.php';
$eng = Social::engagement(array_map(fn($i) => $i['post_id'], $out), Social::currentActor());
foreach ($out as &$it) {
    $e = $eng[$it['post_id']] ?? ['likes' => 0, 'comments' => 0, 'liked' => false];
    $it['likes'] = $e['likes']; $it['comments'] = $e['comments']; $it['liked'] = $e['liked'];
}
unset($it);

Response::success(['items' => $out, 'next_before' => $lastId]);