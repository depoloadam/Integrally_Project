<?php


// =====================================================================
// FILE: api/profile/skills/list.php
// GET ?uuid=<uuid> (public) | none (own, logged in)
// Returns the user's linked skills as a bare array, each row: id, name.
//
// Endorsement decoration (added with the vouching feature): each row
// also carries `endorsements` (int count) and `you_endorsed` (bool for
// the current viewer). The response stays a bare array so existing
// consumers that ignore the extra fields keep working unchanged.
// Whether the viewer may endorse on this profile (mutual-follow) is
// reported by follow/status.php's `mutual` flag, not here.
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';
require_once __DIR__ . '/../../../src/Endorsements.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');

// The signed-in USER viewing (null for guests/company sessions — only
// users endorse, so only a user can have you_endorsed true).
$viewerId = Auth::userId();

if ($uuid === '') {
    $userId = Auth::requireLogin();
} else {
    $stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
    $row = $stmt->fetch();
    if (!$row) Response::error('Profile not found.', 404);
    $userId = (int) $row['id'];
}

$stmt = $pdo->prepare(
    'SELECT s.id, s.name
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     WHERE us.user_id = ?
     ORDER BY s.name ASC'
);
$stmt->execute([$userId]);
$skills = $stmt->fetchAll();

// Decorate each row with endorsement count + viewer's own state.
$skillIds = array_map(fn($s) => (int) $s['id'], $skills);
$endo = Endorsements::forTargetSkills($pdo, $userId, $skillIds, $viewerId);
foreach ($skills as &$s) {
    $sid = (int) $s['id'];
    $s['id']            = (int) $s['id'];
    $s['endorsements']  = $endo[$sid]['count'] ?? 0;
    $s['you_endorsed']  = $endo[$sid]['you_endorsed'] ?? false;
}
unset($s);

Response::success($skills);
