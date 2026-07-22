<?php

// =====================================================================
// FILE: api/posts/personal.php
// GET ?type=user|company&uuid=<uuid>&limit=10&offset=0
// The "personal feed": one author's own posts, newest first.
// Public posts are visible to anyone; 'followers' posts only to the
// owner or to logged-in users who follow that author.
//
// Paged: previously this returned a hard LIMIT 50 with no way past it,
// so a prolific author's older posts were simply unreachable. Now the
// caller pages with limit/offset and gets `has_more` back, which drives
// the "See more" button on the profile. Ordering is (created_at DESC,
// id DESC) — the id tiebreaker keeps paging stable when several posts
// share a timestamp, which would otherwise repeat or skip rows.
//
// Callers that pass no limit still get 50, so existing consumers of this
// endpoint keep working unchanged.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/PostActions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo    = Database::conn();
$type   = trim($_GET['type'] ?? '');
$uuid   = trim($_GET['uuid'] ?? '');
$limit  = (int) ($_GET['limit'] ?? 50);
$offset = max(0, (int) ($_GET['offset'] ?? 0));
if ($limit <= 0)  $limit = 50;
if ($limit > 50)  $limit = 50;   // clamp: no request drags the table out

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

$where = 'WHERE author_type = ? AND author_id = ?';
if (!$canSeeFollowerPosts) {
    $where .= " AND visibility = 'public'";
}

// Optional time-window filter (independent of sort). Included in BOTH the
// count and the page query below so has_more never promises filtered-out
// rows. Whitelisted key -> fixed INTERVAL, no bound params. Alias is
// 'posts' here because this query uses the bare table name.
$period = trim((string) ($_GET['period'] ?? 'all'));
if (!PostActions::isValidPeriod($period)) $period = 'all';
$where .= PostActions::periodClause($period, 'posts');

// Total under the SAME visibility rules as the page itself, so has_more
// can never promise posts the viewer isn't allowed to see.
$cnt = $pdo->prepare("SELECT COUNT(*) AS n FROM posts $where");
$cnt->execute([$type, $authorId]);
$total = (int) $cnt->fetch()['n'];

// LIMIT/OFFSET are interpolated as ints (already validated above) —
// MySQL won't accept them as bound params in a prepared statement.
// Sort mode. 'relevance' has no follow ranking on a single author's own
// posts, so it collapses to 'engagement'. Default newest.
$sort = trim((string) ($_GET['sort'] ?? 'newest'));
require_once __DIR__ . '/../../src/PostActions.php';
if (!PostActions::isValidSort($sort)) $sort = 'newest';
$sortForOrder = ($sort === 'relevance') ? 'engagement' : $sort;
$order = PostActions::orderBy($sortForOrder, 'posts');

$sql = "SELECT id, post_type, body, media_url, meta, visibility, created_at
        FROM posts
        $where
        ORDER BY $order
        LIMIT $limit OFFSET $offset";

$stmt = $pdo->prepare($sql);
$stmt->execute([$type, $authorId]);
$posts = $stmt->fetchAll();
$hasMore = ($offset + count($posts)) < $total;

// Decode the JSON meta column for any structured (e.g. cert) posts.
foreach ($posts as &$pp) {
    $pp['meta'] = $pp['meta'] ? json_decode($pp['meta'], true) : null;
}
unset($pp);

// Decorate with like/comment counts + viewer's like state. Also expose
// post_id (the feed renderer expects post_id, these rows use id).
require_once __DIR__ . '/../../src/Social.php';
$eng = Social::engagement(array_map(fn($p) => (int) $p['id'], $posts), Social::currentActor());
foreach ($posts as &$pp) {
    $pid = (int) $pp['id'];
    $pp['post_id']  = $pid;
    $e = $eng[$pid] ?? ['likes' => 0, 'comments' => 0, 'liked' => false];
    $pp['likes'] = $e['likes']; $pp['comments'] = $e['comments']; $pp['liked'] = $e['liked'];
}
unset($pp);

Response::success([
    'author' => [
        'type'   => $type,
        'uuid'   => $uuid,
        'name'   => $author['name'],
        'avatar' => $author['avatar'],
    ],
    'posts'    => $posts,
    'offset'   => $offset,
    'limit'    => $limit,
    'total'    => $total,
    'has_more' => $hasMore,
]);