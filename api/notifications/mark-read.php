<?php

// =====================================================================
// FILE: api/notifications/mark-read.php
// POST { id }        -> mark one read
// POST { ids: [...] } -> mark several read (one grouped row covers many)
// POST { all: true } -> mark all the actor's notifications read
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$actor = Social::requireActor();
$pdo   = Database::conn();
$in    = Response::input();

if (!empty($in['all'])) {
    $stmt = $pdo->prepare(
        'UPDATE notifications SET is_read = 1
         WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0'
    );
    $stmt->execute([$actor['type'], $actor['id']]);
    Response::success(['marked' => $stmt->rowCount()]);
}

// A grouped row ("Dana and 4 others liked your post") stands in for
// several notification rows, so clicking it must clear all of them or the
// bell badge would stay lit with no visible unread row to explain it.
// Still scoped to the recipient, so ids belonging to someone else are
// simply not matched by the UPDATE.
if (isset($in['ids']) && is_array($in['ids'])) {
    $ids = [];
    foreach ($in['ids'] as $v) {
        $n = (int) $v;
        if ($n > 0) $ids[$n] = true;   // dedupe via key
    }
    $ids = array_keys($ids);
    if (!$ids) Response::error('ids must contain at least one valid id.', 422);
    // Bounded so a malformed client can't send an unbounded IN() list.
    if (count($ids) > 200) $ids = array_slice($ids, 0, 200);

    $place = implode(',', array_fill(0, count($ids), '?'));
    $stmt  = $pdo->prepare(
        "UPDATE notifications SET is_read = 1
         WHERE recipient_type = ? AND recipient_id = ? AND id IN ($place)"
    );
    $stmt->execute(array_merge([$actor['type'], $actor['id']], $ids));
    Response::success(['marked' => $stmt->rowCount()]);
}

$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('id or all is required.', 422);

// Only the recipient can mark their own notification read.
$stmt = $pdo->prepare(
    'UPDATE notifications SET is_read = 1
     WHERE id = ? AND recipient_type = ? AND recipient_id = ?'
);
$stmt->execute([$id, $actor['type'], $actor['id']]);

Response::success(['marked' => $stmt->rowCount()]);