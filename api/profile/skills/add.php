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
require_once __DIR__ . '/../../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

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

    // Duplicate guard: does the user already have this skill linked?
    // The user_skills PK (user_id, skill_id) already makes the link
    // idempotent, but a silent success gives the UI nothing to say —
    // which reads to the user as "the Add button did nothing". Detect
    // the duplicate explicitly and surface it with a machine-readable
    // code so the frontend can toast "You already have that skill".
    $has = $pdo->prepare(
        'SELECT 1 FROM user_skills WHERE user_id = ? AND skill_id = ? LIMIT 1'
    );
    $has->execute([$userId, $skillId]);
    if ($has->fetchColumn()) {
        $pdo->commit();  // nothing to write, but close the txn cleanly
        Response::error('You already have that skill on your profile.', 409, 'already_exists');
    }

    // Link user -> skill.
    $pdo->prepare(
        'INSERT INTO user_skills (user_id, skill_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE skill_id = VALUES(skill_id)'
    )->execute([$userId, $skillId]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}

Response::success(['skill_id' => $skillId, 'name' => $name], 201);
