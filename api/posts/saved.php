<?php

// =====================================================================
// FILE: api/posts/saved.php
// GET ?before=<save_created_at>   (optional keyset pagination)
// Returns the current actor's saved posts, most-recently-saved first,
// in the same item shape renderPost() consumes on the feed.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/PostActions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();
$limit = 20;

// Sort mode. On the saved list there's no follow ranking, so 'relevance'
// collapses to 'engagement'. Default keeps most-recently-saved first.
$sort = trim((string) ($_GET['sort'] ?? 'saved'));
$validSaved = in_array($sort, ['saved', 'newest', 'oldest', 'engagement', 'relevance'], true);
if (!$validSaved) $sort = 'saved';

// Keyset on the save timestamp (stable enough; ties broken by post id).
$before = isset($_GET['before']) ? trim((string) $_GET['before']) : '';
$sql =
    'SELECT ps.created_at AS saved_at,
            p.id AS post_id, p.author_type, p.author_id,
            p.post_type, p.body, p.media_url, p.meta, p.created_at
       FROM post_saves ps
       JOIN posts p ON p.id = ps.post_id
      WHERE ps.actor_type = ? AND ps.actor_id = ?';
$params = [$actor['type'], $actor['id']];
// Keyset pagination only applies to the default "saved" order (the only
// order that's monotonic on ps.created_at). Other sorts return the first
// page unpaginated — the client doesn't page the saved list.
if ($sort === 'saved' && $before !== '') {
    $sql .= ' AND ps.created_at < ?';
    $params[] = $before;
}

// Optional time-window filter — on the POST's creation time (when it was
// posted), consistent with the other surfaces, not when it was saved.
$period = trim((string) ($_GET['period'] ?? 'all'));
if (!PostActions::isValidPeriod($period)) $period = 'all';
$sql .= PostActions::periodClause($period, 'p');

switch ($sort) {
    case 'newest':
        $order = 'p.created_at DESC, p.id DESC'; break;
    case 'oldest':
        $order = 'p.created_at ASC, p.id ASC'; break;
    case 'engagement':
    case 'relevance':
        $order = '((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)'
               . ' + (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id)) DESC,'
               . ' ps.created_at DESC'; break;
    case 'saved':
    default:
        $order = 'ps.created_at DESC, p.id DESC'; break;
}
$sql .= ' ORDER BY ' . $order . ' LIMIT ' . (int) $limit;

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$items = [];
$lastSavedAt = null;
foreach ($rows as $r) {
    $info = Social::actorInfo($r['author_type'], (int) $r['author_id']);
    $items[] = [
        'post_id'    => (int) $r['post_id'],
        'post_type'  => $r['post_type'],
        'body'       => $r['body'],
        'media_url'  => $r['media_url'],
        'meta'       => $r['meta'] ? json_decode($r['meta'], true) : null,
        'created_at' => $r['created_at'],
        'author'     => [
            'type'   => $info['type'],
            'uuid'   => $info['uuid'],
            'name'   => $info['name'],
            'avatar' => $info['avatar'],
        ],
    ];
    $lastSavedAt = $r['saved_at'];
}

// Decorate: like/comment counts, viewer like state, and saved flag
// (always true here, but keeps the item shape identical to the feed).
$ids = array_map(fn($i) => $i['post_id'], $items);
$eng = Social::engagement($ids, $actor);
$saved = PostActions::savedMap($actor, $ids);
foreach ($items as &$it) {
    $e = $eng[$it['post_id']] ?? ['likes' => 0, 'comments' => 0, 'liked' => false];
    $it['likes'] = $e['likes']; $it['comments'] = $e['comments']; $it['liked'] = $e['liked'];
    $it['saved'] = isset($saved[$it['post_id']]);
}
unset($it);

Response::success([
    'items'     => $items,
    'next'      => count($items) === $limit ? $lastSavedAt : null,
]);
