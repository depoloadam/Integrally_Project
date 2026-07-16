<?php

// =====================================================================
// FILE: api/feed/company.php
// GET ?before=<post_id>   (optional, for pagination)
// The COMPANY "Following" feed: recent posts from authors the signed-in
// COMPANY follows, plus the company's own posts, newest first.
//
// Unlike the user main feed (fan-out-on-write into feed_items, which is
// keyed by user_id), this is computed at READ time straight from the
// follows table. Company follower counts are tiny compared to user
// traffic, so the join is cheap — and it means zero schema coupling.
//
// Visibility: 'followers'-only posts are included, which is correct —
// the company follows the author, so it IS a follower.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/PostActions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();
$actor     = ['type' => 'company', 'id' => $companyId];

$before = (int) ($_GET['before'] ?? 0);
$limit  = 20;

// Posts from followed authors, or the company's own posts (mirrors the
// 'self' rows a user gets via fan-out).
$sql = '
    SELECT p.id AS post_id, p.author_type, p.author_id,
           p.post_type, p.body, p.media_url, p.meta, p.created_at
    FROM posts p
    WHERE (
        EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_type = \'company\' AND f.follower_id = ?
              AND f.target_type = p.author_type AND f.target_id = p.author_id
        )
        OR (p.author_type = \'company\' AND p.author_id = ?)
    )';
$params = [$companyId, $companyId];
if ($before > 0) {
    $sql .= ' AND p.id < ?';
    $params[] = $before;
}
// Exclude hidden posts / muted authors for this company.
$excl   = PostActions::feedExclusion($actor, 'p');
$sql   .= $excl['sql'];
$params = array_merge($params, $excl['params']);
$sql   .= ' ORDER BY p.created_at DESC, p.id DESC LIMIT ' . (int) $limit;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

// Resolve author display info per post (small N per page).
$userStmt    = $pdo->prepare('SELECT uuid, username, profile_pic FROM users WHERE id = ? LIMIT 1');
$companyStmt = $pdo->prepare('SELECT uuid, name, logo FROM companies WHERE id = ? LIMIT 1');

$feed = [];
$lastId = null;
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

    $isSelf = ($r['author_type'] === 'company' && (int) $r['author_id'] === $companyId);

    $feed[] = [
        'post_id'    => (int) $r['post_id'],
        'post_type'  => $r['post_type'],
        'body'       => $r['body'],
        'media_url'  => $r['media_url'],
        'meta'       => $r['meta'] ? json_decode($r['meta'], true) : null,
        'created_at' => $r['created_at'],
        'reason'     => $isSelf ? 'self' : 'followed',
        'author'     => $author,
    ];
    $lastId = (int) $r['post_id'];
}

// Decorate with like/comment counts + viewer's like state.
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
    'next_before' => $lastId,   // pass back as ?before= for the next page
]);
