<?php

// =====================================================================
// FILE: api/admin/reports.php
// GET ?status=open|reviewed|dismissed&reason=<key>&q=&page=1&limit=25
// Admin-only. Lists reported posts for the moderation queue.
//
// Rows are GROUPED BY POST, not per report: a post reported by twelve
// people is one row with report_count = 12, so the queue reflects the
// work to be done rather than the volume of complaints. The status
// filter matches a post if ANY of its reports carry that status, and
// report_count/reasons are then scoped to the matching reports so the
// numbers on screen agree with the filter above them.
//
// Posts deleted after being reported leave orphan report rows; those
// are surfaced with post_deleted = true rather than hidden, so an
// admin can still clear them out of the queue.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/PostActions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$status = trim($_GET['status'] ?? 'open');
$reason = trim($_GET['reason'] ?? '');
$q      = trim($_GET['q'] ?? '');
$page   = max(1, (int) ($_GET['page'] ?? 1));
$limit  = (int) ($_GET['limit'] ?? 25);
if ($limit <= 0)  $limit = 25;
if ($limit > 100) $limit = 100;
$offset = ($page - 1) * $limit;

$VALID_STATUS = ['open', 'reviewed', 'dismissed'];
if ($status !== '' && !in_array($status, $VALID_STATUS, true)) {
    Response::error('Invalid status filter.', 422);
}
if ($reason !== '' && !PostActions::isValidReason($reason)) {
    Response::error('Invalid reason filter.', 422);
}

// ---- report-level filters -------------------------------------------
// These constrain WHICH REPORTS count toward each grouped row, so the
// count and reason list always describe the filtered set.
$rWhere  = [];
$rParams = [];
if ($status !== '') { $rWhere[] = 'r.status = ?'; $rParams[] = $status; }
if ($reason !== '') { $rWhere[] = 'r.reason = ?'; $rParams[] = $reason; }
$rWhereSql = $rWhere ? ('WHERE ' . implode(' AND ', $rWhere)) : '';

// ---- post-level filter (search) --------------------------------------
// LEFT JOIN posts: a report whose post was already deleted must still
// appear, so the search predicate has to tolerate NULL post rows.
$pWhere  = [];
$pParams = [];
if ($q !== '') {
    $pWhere[] = '(p.body LIKE ? OR u.username LIKE ? OR c.name LIKE ?)';
    $like     = '%' . $q . '%';
    array_push($pParams, $like, $like, $like);
}
$pWhereSql = $pWhere ? ('WHERE ' . implode(' AND ', $pWhere)) : '';

// Reports collapsed to one row per post. The COLLATE cast on the
// author_type join guards the general_ci/unicode_ci mismatch that the
// stale sql dump can introduce between tables (see PostActions notes).
$groupSql = "
    FROM (
        SELECT r.post_id,
               COUNT(*)                      AS report_count,
               MAX(r.created_at)             AS last_reported,
               MIN(r.created_at)             AS first_reported,
               GROUP_CONCAT(DISTINCT r.reason ORDER BY r.reason SEPARATOR ',') AS reasons,
               SUM(r.status = 'open')        AS open_count
        FROM post_reports r
        {$rWhereSql}
        GROUP BY r.post_id
    ) g
    LEFT JOIN posts p     ON p.id = g.post_id
    LEFT JOIN users u     ON p.author_type COLLATE utf8mb4_unicode_ci = 'user'
                         AND u.id = p.author_id
    LEFT JOIN companies c ON p.author_type COLLATE utf8mb4_unicode_ci = 'company'
                         AND c.id = p.author_id
    {$pWhereSql}";

$countStmt = $pdo->prepare("SELECT COUNT(*) AS c {$groupSql}");
$countStmt->execute(array_merge($rParams, $pParams));
$total = (int) $countStmt->fetch()['c'];

// Most-reported first, then most recent. g.post_id breaks ties so
// offset paging can't repeat or skip rows between pages.
$stmt = $pdo->prepare(
    "SELECT g.post_id, g.report_count, g.last_reported, g.first_reported,
            g.reasons, g.open_count,
            p.id AS live_post_id, p.author_type, p.post_type, p.body,
            p.media_url, p.visibility, p.created_at AS post_created_at,
            CASE WHEN p.author_type = 'user' THEN u.username ELSE c.name END AS author_name,
            CASE WHEN p.author_type = 'user' THEN u.uuid     ELSE c.uuid END AS author_uuid
     {$groupSql}
     ORDER BY g.report_count DESC, g.last_reported DESC, g.post_id DESC
     LIMIT {$limit} OFFSET {$offset}"
);
$stmt->execute(array_merge($rParams, $pParams));
$rows = $stmt->fetchAll();

// ---- per-post reporter detail ----------------------------------------
// One extra query for the whole page rather than one per row. Reporter
// names are resolved polymorphically, same as post authors.
$postIds = array_map(static fn($r) => (int) $r['post_id'], $rows);
$details = [];
if ($postIds) {
    $in       = implode(',', array_fill(0, count($postIds), '?'));
    $detParams = $postIds;
    $detWhere  = '';
    if ($status !== '') { $detWhere .= ' AND r.status = ?'; $detParams[] = $status; }
    if ($reason !== '') { $detWhere .= ' AND r.reason = ?'; $detParams[] = $reason; }

    $d = $pdo->prepare(
        "SELECT r.id, r.post_id, r.reason, r.detail, r.status, r.created_at,
                r.actor_type, r.actor_id,
                CASE WHEN r.actor_type = 'user' THEN ru.username ELSE rc.name END AS reporter_name
         FROM post_reports r
         LEFT JOIN users ru     ON r.actor_type COLLATE utf8mb4_unicode_ci = 'user'
                               AND ru.id = r.actor_id
         LEFT JOIN companies rc ON r.actor_type COLLATE utf8mb4_unicode_ci = 'company'
                               AND rc.id = r.actor_id
         WHERE r.post_id IN ({$in}){$detWhere}
         ORDER BY r.created_at DESC, r.id DESC"
    );
    $d->execute($detParams);
    foreach ($d->fetchAll() as $row) {
        $pid = (int) $row['post_id'];
        if (!isset($details[$pid])) $details[$pid] = [];
        // Cap the per-post reporter list: a brigaded post could
        // otherwise return hundreds of rows into one table cell.
        if (count($details[$pid]) >= 20) continue;
        $details[$pid][] = [
            'id'            => (int) $row['id'],
            'reason'        => $row['reason'],
            'reason_label'  => PostActions::REASONS[$row['reason']] ?? $row['reason'],
            'detail'        => $row['detail'],
            'status'        => $row['status'],
            'reporter_type' => $row['actor_type'],
            'reporter_name' => $row['reporter_name'],
            'created_at'    => $row['created_at'],
        ];
    }
}

$reports = [];
foreach ($rows as $r) {
    $deleted = $r['live_post_id'] === null;

    $plain = '';
    if (!$deleted) {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($r['body'] ?? ''))));
        if (mb_strlen($plain) > 140) $plain = mb_substr($plain, 0, 140) . '…';
    }

    $reasonKeys = array_filter(explode(',', (string) $r['reasons']));

    $reports[] = [
        'post_id'       => (int) $r['post_id'],
        'post_deleted'  => $deleted,
        'report_count'  => (int) $r['report_count'],
        'open_count'    => (int) $r['open_count'],
        'reasons'       => array_values(array_map(
            static fn($k) => ['key' => $k, 'label' => PostActions::REASONS[$k] ?? $k],
            $reasonKeys
        )),
        'first_reported' => $r['first_reported'],
        'last_reported'  => $r['last_reported'],
        'author_type'    => $r['author_type'],
        'author_name'    => $r['author_name'],
        'author_uuid'    => $r['author_uuid'],
        'post_type'      => $r['post_type'],
        'snippet'        => $plain,
        'has_media'      => !$deleted && !empty($r['media_url']),
        'visibility'     => $r['visibility'],
        'post_created_at' => $r['post_created_at'],
        'reporters'      => $details[(int) $r['post_id']] ?? [],
    ];
}

// Queue badge counts, unaffected by the current filters so the tab can
// always show how much genuinely open work is waiting.
$openPosts = (int) $pdo->query(
    "SELECT COUNT(DISTINCT post_id) AS c FROM post_reports WHERE status = 'open'"
)->fetch()['c'];

Response::success([
    'reports'    => $reports,
    'reasons'    => PostActions::REASONS,
    'open_posts' => $openPosts,
    'page'       => $page,
    'limit'      => $limit,
    'total'      => $total,
]);
