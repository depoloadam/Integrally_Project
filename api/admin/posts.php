<?php

// =====================================================================
// FILE: api/admin/posts.php
// GET ?q=&author_type=user|company&page=1&limit=25
// Admin-only. Lists ALL posts newest-first for the moderation section,
// with author info resolved polymorphically plus like/comment counts.
//   q           -> matches post body, username, or company name
//   author_type -> optional filter
// Deletion goes through the existing /posts/delete.php, which already
// has an admin override (admins can delete ANY post).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$q          = trim($_GET['q'] ?? '');
$authorType = trim($_GET['author_type'] ?? '');
$page       = max(1, (int) ($_GET['page'] ?? 1));
$limit      = (int) ($_GET['limit'] ?? 25);
if ($limit <= 0)  $limit = 25;
if ($limit > 100) $limit = 100;
$offset = ($page - 1) * $limit;

$where  = [];
$params = [];

if ($q !== '') {
    $where[] = '(p.body LIKE ? OR u.username LIKE ? OR c.name LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like, $like);
}
if ($authorType !== '') {
    if ($authorType !== 'user' && $authorType !== 'company') {
        Response::error("author_type must be 'user' or 'company'.", 422);
    }
    $where[]  = 'p.author_type = ?';
    $params[] = $authorType;
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

// Shared FROM clause: join both possible author tables and pick the
// matching one per row (same polymorphic pattern as the feeds).
$fromSql = "FROM posts p
            LEFT JOIN users u     ON p.author_type = 'user'    AND u.id = p.author_id
            LEFT JOIN companies c ON p.author_type = 'company' AND c.id = p.author_id";

$countStmt = $pdo->prepare("SELECT COUNT(*) AS c {$fromSql} {$whereSql}");
$countStmt->execute($params);
$total = (int) $countStmt->fetch()['c'];

$stmt = $pdo->prepare(
    "SELECT p.id, p.author_type, p.post_type, p.body, p.media_url,
            p.visibility, p.created_at,
            CASE WHEN p.author_type = 'user' THEN u.username ELSE c.name END AS author_name,
            CASE WHEN p.author_type = 'user' THEN u.uuid     ELSE c.uuid END AS author_uuid,
            (SELECT COUNT(*) FROM post_likes    pl WHERE pl.post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comments
     {$fromSql}
     {$whereSql}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute($params);

// Build a plain-text snippet server-side: the body is sanitized rich-text
// HTML, so strip tags and clip for the table view.
$posts = [];
foreach ($stmt->fetchAll() as $r) {
    $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($r['body'] ?? ''))));
    if (mb_strlen($plain) > 140) $plain = mb_substr($plain, 0, 140) . '…';
    $posts[] = [
        'id'          => (int) $r['id'],
        'author_type' => $r['author_type'],
        'author_name' => $r['author_name'],
        'author_uuid' => $r['author_uuid'],
        'post_type'   => $r['post_type'],
        'snippet'     => $plain,
        'has_media'   => !empty($r['media_url']),
        'visibility'  => $r['visibility'],
        'likes'       => (int) $r['likes'],
        'comments'    => (int) $r['comments'],
        'created_at'  => $r['created_at'],
    ];
}

Response::success([
    'posts' => $posts,
    'page'  => $page,
    'limit' => $limit,
    'total' => $total,
]);
