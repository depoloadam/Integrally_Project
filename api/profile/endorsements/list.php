<?php

// =====================================================================
// FILE: api/profile/endorsements/list.php
// GET ?uuid=<target-uuid>
// Returns the endorsement DETAIL for a user's profile: for each of the
// target's skills, the list of endorsers (who vouched) plus the count.
//
// This reveals endorser identities, so it is gated exactly like the
// endorse action itself:
//   - viewer must be signed in AS A USER (companies can't see this;
//     endorsing is a user-only trust edge)
//   - viewer must be a MUTUAL FOLLOW of the target, OR be the target
//     themselves (owner viewing their own profile detail)
//   - guests are rejected
//
// Shape:
//   { skills: [ { id, name, count, endorsers: [ {uuid, username,
//                 profile_pic, created_at}, ... ] }, ... ],
//     total: <int> }   // total endorsements across all skills
// Skills are ordered by count desc then name; only skills with at least
// one endorsement are returned (nothing to show otherwise).
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';
require_once __DIR__ . '/../../../src/Endorsements.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

// Viewing endorser identities is a user-only capability. A company
// session is signed in but has no place in the user<->user trust graph.
$viewerId = Auth::userId();
if ($viewerId === null) {
    if (Auth::companyId() !== null) {
        Response::error('Companies cannot view endorsement details.', 403, 'not_a_user');
    }
    Response::error('You must be signed in.', 401);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');
if ($uuid === '') Response::error('A target uuid is required.', 422);

// Resolve target user.
$stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$uuid]);
$row = $stmt->fetch();
if (!$row) Response::error('Profile not found.', 404);
$targetId = (int) $row['id'];

// Gate: owner sees their own detail; otherwise mutual-follow required.
$isOwner = ($viewerId === $targetId);
if (!$isOwner && !Endorsements::areMutual($pdo, $viewerId, $targetId)) {
    Response::error(
        'Endorsement details are visible only to connections (mutual follow).',
        403,
        'not_connected'
    );
}

// Target's skills.
$stmt = $pdo->prepare(
    'SELECT s.id, s.name
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     WHERE us.user_id = ?'
);
$stmt->execute([$targetId]);
$skills = $stmt->fetchAll();

$skillIds = array_map(fn($s) => (int) $s['id'], $skills);
$byId     = [];
foreach ($skills as $s) $byId[(int) $s['id']] = $s['name'];

$endorsers = Endorsements::endorsersForTargetSkills($pdo, $targetId, $skillIds);

$out   = [];
$total = 0;
foreach ($endorsers as $sid => $people) {
    $n = count($people);
    if ($n === 0) continue;   // only surface skills that have endorsements
    $total += $n;
    $out[] = [
        'id'        => (int) $sid,
        'name'      => $byId[$sid] ?? '',
        'count'     => $n,
        'endorsers' => $people,
    ];
}

// Order by count desc, then skill name asc for stable display.
usort($out, function ($a, $b) {
    if ($b['count'] !== $a['count']) return $b['count'] - $a['count'];
    return strcasecmp($a['name'], $b['name']);
});

Response::success([
    'skills' => $out,
    'total'  => $total,
]);
