<?php

// =====================================================================
// FILE: api/profile/endorsements/set.php
// POST { target_uuid*, skill_id*, endorse: true|false }
// Toggle the current USER's endorsement of one skill on another user's
// profile. On a NEW endorsement, notifies the target ('endorsement').
//
// Server-enforced gate (client checks are early-warning only):
//   - viewer must be signed in AS A USER (companies don't endorse)
//   - target must exist and not be the viewer (no self-endorsement)
//   - viewer and target must be a MUTUAL FOLLOW
//   - the skill must be linked on the target's profile
//
// Returns the fresh count and the viewer's new state for that skill.
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';
require_once __DIR__ . '/../../../src/Social.php';
require_once __DIR__ . '/../../../src/Endorsements.php';
require_once __DIR__ . '/../../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

// Endorsing is a user-only action. A company session may be signed in,
// but companies can't vouch for a person's skills — reject explicitly
// rather than silently treating it as "not signed in".
$viewerId = Auth::userId();
if ($viewerId === null) {
    if (Auth::companyId() !== null) {
        Response::error('Companies cannot endorse skills.', 403, 'not_a_user');
    }
    Response::error('You must be signed in.', 401);
}

$pdo = Database::conn();
$in  = Response::input();

$targetUuid = trim($in['target_uuid'] ?? '');
$skillId    = (int) ($in['skill_id'] ?? 0);
$want       = !empty($in['endorse']);

if ($targetUuid === '') Response::error('target_uuid is required.', 422);
if ($skillId <= 0)      Response::error('skill_id is required.', 422);

// Resolve target user.
$stmt = $pdo->prepare('SELECT id FROM users WHERE uuid = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$targetUuid]);
$row = $stmt->fetch();
if (!$row) Response::error('Profile not found.', 404);
$targetId = (int) $row['id'];

// No self-endorsement.
if ($targetId === $viewerId) {
    Response::error('You cannot endorse your own skills.', 422, 'self_endorse');
}

// The skill must actually be on the target's profile.
if (!Endorsements::targetHasSkill($pdo, $targetId, $skillId)) {
    Response::error('That skill is not on this profile.', 422, 'skill_not_on_profile');
}

// Mutual-follow gate — the core anti-abuse property. Enforced on BOTH
// endorse and un-endorse: if the connection has since broken, an
// existing endorsement can still be removed, so we only require mutual
// for the ADD path. Removing is always allowed by the endorser.
if ($want) {
    if (!Endorsements::areMutual($pdo, $viewerId, $targetId)) {
        Response::error(
            'You can only endorse people you are connected with (mutual follow).',
            403,
            'not_connected'
        );
    }
    $created = Endorsements::add($pdo, $targetId, $skillId, $viewerId);
    if ($created) {
        // 'endorsement' is an ungated notification type (Social::notify
        // only gates like/comment/follow/message_request), so this always
        // notifies unless the recipient is the actor (never, here).
        Social::notify('user', $targetId, 'user', $viewerId, 'endorsement');
    }
} else {
    $removed = Endorsements::remove($pdo, $targetId, $skillId, $viewerId);
    if ($removed) {
        // Tidy any endorsement notification this endorser produced. There
        // is no post/comment id to scope by, so scope by actor+recipient+
        // type. This can clear an unrelated older endorsement notification
        // from the same endorser, but endorsement notifications are not
        // per-skill addressable and this keeps the unread count honest.
        $del = $pdo->prepare(
            'DELETE FROM notifications
             WHERE type = "endorsement"
               AND recipient_type = "user" AND recipient_id = ?
               AND actor_type = "user"     AND actor_id = ?'
        );
        $del->execute([$targetId, $viewerId]);
    }
}

$count = Endorsements::count($pdo, $targetId, $skillId);

Response::success([
    'skill_id'     => $skillId,
    'endorsements' => $count,
    'you_endorsed' => $want,
]);
