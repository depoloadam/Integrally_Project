<?php

// =====================================================================
// FILE: api/blocks/list.php
// GET -> everyone the current actor has blocked, with display info so a
// settings surface can show a "Blocked people" list with unblock buttons.
//
// This is the identity-level companion to messages/block.php, which works
// per-conversation. Here we resolve blocked *users* directly from the
// blocks table so the list works even without an existing conversation.
//
// Only user->user blocks are surfaced (the messaging block UI only ever
// creates user-actor blocks). Company actors get an empty list for now.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$actor = Social::requireActor();
$pdo   = Database::conn();

// Pull blocks this actor placed on USER targets.
$stmt = $pdo->prepare(
    'SELECT blocked_id, created_at
       FROM blocks
      WHERE blocker_type = ? AND blocker_id = ? AND blocked_type = ?
      ORDER BY created_at DESC'
);
$stmt->execute([$actor['type'], $actor['id'], 'user']);
$rows = $stmt->fetchAll();

$out = [];
if ($rows) {
    $ids = array_map(fn($r) => (int) $r['blocked_id'], $rows);
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $us  = $pdo->prepare(
        "SELECT id, uuid, username, first_name, last_name, profile_pic
           FROM users
          WHERE id IN ($ph)"
    );
    $us->execute($ids);
    $byId = [];
    foreach ($us->fetchAll() as $u) {
        $byId[(int) $u['id']] = $u;
    }
    // Preserve block-recency order from $rows.
    foreach ($rows as $r) {
        $u = $byId[(int) $r['blocked_id']] ?? null;
        if (!$u) continue;   // account gone/deactivated — skip silently
        $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
        $out[] = [
            'uuid'        => $u['uuid'],
            'username'    => $u['username'],
            'name'        => $name !== '' ? $name : $u['username'],
            'profile_pic' => $u['profile_pic'] ?: null,
            'blocked_at'  => $r['created_at'],
        ];
    }
}

Response::success($out);
