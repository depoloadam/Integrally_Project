<?php


// =====================================================================
// FILE: api/profile/interests/add.php
// POST { name* }
// Find-or-create the interest, then link to the user. Idempotent.
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$name = trim($in['name'] ?? '');
if ($name === '') Response::error('Interest name is required.', 422);
if (strlen($name) > 100) Response::error('Interest name is too long.', 422);

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare('SELECT id FROM interests WHERE name = ? LIMIT 1');
    $stmt->execute([$name]);
    $interest = $stmt->fetch();

    if ($interest) {
        $interestId = (int) $interest['id'];
    } else {
        $pdo->prepare('INSERT INTO interests (name) VALUES (?)')->execute([$name]);
        $interestId = (int) $pdo->lastInsertId();
    }

    // user_interests has a composite PK (user_id, interest_id), so a
    // duplicate link is simply ignored.
    $pdo->prepare(
        'INSERT IGNORE INTO user_interests (user_id, interest_id) VALUES (?, ?)'
    )->execute([$userId, $interestId]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

Response::success(['interest_id' => $interestId, 'name' => $name], 201);
