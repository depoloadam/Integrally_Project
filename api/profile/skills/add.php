<?php


// =====================================================================
// FILE: api/profile/skills/add.php
// POST { name* }
// Find-or-create the skill by name, then link it to the user.
// Idempotent: re-adding an existing skill is a silent no-op.
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
if ($name === '') Response::error('Skill name is required.', 422);
if (strlen($name) > 100) Response::error('Skill name is too long.', 422);

// Do the find-or-create + link as one transaction so a failure
// can't leave a half-finished state.
try {
    $pdo->beginTransaction();

    // Find-or-create the master skill row (case-insensitive match).
    $stmt = $pdo->prepare('SELECT id FROM skills WHERE name = ? LIMIT 1');
    $stmt->execute([$name]);
    $skill = $stmt->fetch();

    if ($skill) {
        $skillId = (int) $skill['id'];
    } else {
        $pdo->prepare('INSERT INTO skills (name) VALUES (?)')->execute([$name]);
        $skillId = (int) $pdo->lastInsertId();
    }

    // Link user -> skill. ON DUPLICATE is a no-op so re-adding an
    // existing skill succeeds silently instead of erroring.
    $pdo->prepare(
        'INSERT INTO user_skills (user_id, skill_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE skill_id = VALUES(skill_id)'
    )->execute([$userId, $skillId]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

Response::success(['skill_id' => $skillId, 'name' => $name], 201);
