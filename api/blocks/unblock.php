<?php

// =====================================================================
// FILE: api/blocks/unblock.php
// POST { uuid }  -> remove a block YOU placed on the given user, by their
// public uuid. Identity-level companion to messages/unblock.php (which
// requires a conversation_id). Only removes the block in YOUR direction;
// if they also blocked you, that stands. Idempotent.
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
$in    = Response::input();
$uuid  = trim((string) ($in['uuid'] ?? ''));
if ($uuid === '') Response::error('A user uuid is required.', 422);

$pdo = Database::conn();
$look = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
$look->execute([$uuid]);
$found = $look->fetch();
if (!$found) Response::error('User not found.', 404);

$pdo->prepare(
    'DELETE FROM blocks
      WHERE blocker_type = ? AND blocker_id = ?
        AND blocked_type = ? AND blocked_id = ?'
)->execute([$actor['type'], $actor['id'], 'user', (int) $found['id']]);

Response::success(['blocked' => false]);
