<?php

// =====================================================================
// FILE: api/mentions/search.php
// GET ?q=<prefix>&limit=<n>
// ---------------------------------------------------------------------
// Typeahead for the "@" picker in the composer and comment box.
//
// Prefix-matched rather than substring-matched: typing "@al" should
// offer people whose handle STARTS with "al", which is what the caret
// position implies. Substring matching here would surface confusing
// results ("@al" offering "michael").
//
// Ordering puts exact-prefix username matches first, then name matches,
// so the person you are most likely typing at lands under the caret.
//
// Privacy: mirrors api/search/global.php and api/profile/card.php —
// users with discoverable='0' are excluded, so opting out of discovery
// also means not being offered in the mention picker. The requester is
// excluded too, since self-mentions are not supported.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

// Fires on keystrokes (debounced client-side), so it shares the search
// bucket rather than the tighter write/read ones.
RateLimit::guard('search');

$actor = Social::currentActor();
if ($actor === null) {
    Response::error('You must be logged in.', 401);
}

$pdo = Database::conn();

$q     = trim($_GET['q'] ?? '');
$limit = (int) ($_GET['limit'] ?? 6);
if ($limit <= 0)  $limit = 6;
if ($limit > 10)  $limit = 10;

// A bare "@" with nothing after it shouldn't scan the user table.
if ($q === '') {
    Response::success(['results' => []]);
}

// Only the author (a user) can be excluded — a company session has no
// username, so there is nothing of its own to filter out.
$excludeUserId = ($actor['type'] === 'user') ? (int) $actor['id'] : 0;

$prefix = $q . '%';

$stmt = $pdo->prepare(
    "SELECT u.id, u.uuid, u.username, u.first_name, u.last_name,
            u.profile_pic, u.is_verified
     FROM users u
     LEFT JOIN user_settings us
            ON us.user_id = u.id AND us.setting_key = 'discoverable'
     WHERE u.is_active = 1
       AND u.id <> ?
       AND (us.setting_value IS NULL OR us.setting_value <> '0')
       AND (u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)
     ORDER BY
       CASE WHEN u.username LIKE ? THEN 0 ELSE 1 END,
       CHAR_LENGTH(u.username),
       u.username
     LIMIT ?"
);
$stmt->bindValue(1, $excludeUserId, PDO::PARAM_INT);
$stmt->bindValue(2, $prefix);
$stmt->bindValue(3, $prefix);
$stmt->bindValue(4, $prefix);
$stmt->bindValue(5, $prefix);
$stmt->bindValue(6, $limit, PDO::PARAM_INT);
$stmt->execute();

$results = [];
foreach ($stmt->fetchAll() as $u) {
    $full = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
    $results[] = [
        'uuid'      => $u['uuid'],
        'username'  => $u['username'],
        'name'      => $full !== '' ? $full : $u['username'],
        'avatar'    => $u['profile_pic'],
        'verified'  => (bool) (int) $u['is_verified'],
    ];
}

Response::success(['results' => $results]);
