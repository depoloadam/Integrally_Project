<?php

// =====================================================================
// FILE: api/profile/card.php
// GET ?type=user|company&uuid=<uuid>
// ---------------------------------------------------------------------
// Minimal payload behind the hover cards that appear when pointing at a
// person or company anywhere in the app. Deliberately NOT a trimmed
// api/profile/get.php: this is a hot, high-frequency read (every hover
// intent fires one) so it does the smallest possible amount of work and
// returns only what the card renders.
//
// Signed-out callers are allowed. They get identity + public stats and
// every action button disabled — mirrors the fact that #user/<uuid>
// already renders for anonymous visitors.
//
// PRIVACY. This endpoint re-applies the same rules as the full profile
// surfaces rather than inventing its own, so a hover card can never leak
// something the profile page would hide:
//   discoverable = '0'   -> 404 to everyone except the owner. Opting out
//                           of discovery has to mean opting out of the
//                           hover preview too, or the setting is a lie.
//   show_city    = '0'   -> location omitted   (default ON)
//   hide_all_scores='1'  -> score omitted      (default off)
//   hide_follow_lists='1'-> counts omitted     (default off)
// Hidden individual scores (hidden_scores) are excluded for visitors.
//
// Blocks: if either party has blocked the other, the card still renders
// (the profile page does too) but Message is disabled with a reason.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/Messaging.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

// Hover generates far more requests than a click ever would, so this
// gets its own generous bucket rather than sharing 'search'. The client
// caches per (type,uuid) and debounces, so a normal session stays well
// under this; a scripted scrape does not.
RateLimit::guard('hover_card');

$pdo   = Database::conn();
$actor = Social::currentActor();          // nullable — signed out is fine

$type = trim($_GET['type'] ?? '');
$uuid = trim($_GET['uuid'] ?? '');

if ($type !== 'user' && $type !== 'company') {
    Response::error("type must be 'user' or 'company'.", 422);
}
if ($uuid === '') {
    Response::error('A uuid is required.', 422);
}

// =====================================================================
// COMPANY
// =====================================================================
if ($type === 'company') {
    $stmt = $pdo->prepare(
        'SELECT id, uuid, name, logo, industry, city, state, country,
                description, website, is_verified, is_active
         FROM companies WHERE uuid = ? LIMIT 1'
    );
    $stmt->execute([$uuid]);
    $co = $stmt->fetch();
    if (!$co || !(int) $co['is_active']) {
        Response::error('Not found.', 404);
    }

    $coId = (int) $co['id'];

    // Follower count (who follows this company).
    $fc = $pdo->prepare(
        "SELECT COUNT(*) FROM follows WHERE target_type = 'company' AND target_id = ?"
    );
    $fc->execute([$coId]);
    $followers = (int) $fc->fetchColumn();

    // Open roles — drives the "View openings" affordance. Wrapped
    // because `jobs` is one of the tables missing from repo SQL; a
    // fresh environment without it should degrade to 0, not 500.
    $openings = 0;
    try {
        $oc = $pdo->prepare(
            "SELECT COUNT(*) FROM jobs WHERE company_id = ? AND status = 'open'"
        );
        $oc->execute([$coId]);
        $openings = (int) $oc->fetchColumn();
    } catch (\Throwable $e) {
        $openings = 0;
    }

    // Does the current actor follow this company?
    $following = false;
    $isSelf    = ($actor !== null && $actor['type'] === 'company' && (int) $actor['id'] === $coId);
    if ($actor !== null && !$isSelf) {
        $fs = $pdo->prepare(
            "SELECT 1 FROM follows
             WHERE follower_type = ? AND follower_id = ?
               AND target_type = 'company' AND target_id = ? LIMIT 1"
        );
        $fs->execute([$actor['type'], $actor['id'], $coId]);
        $following = (bool) $fs->fetch();
    }

    $location = trim(implode(', ', array_filter([
        $co['city'] ?: null,
        $co['state'] ?: null,
    ])));

    // Company descriptions are free-form and can run long; the card has
    // room for roughly one line. Strip any markup the rich-text editor
    // left behind, collapse whitespace, then clamp on a word boundary.
    $subtitle = null;
    $rawDesc  = trim(strip_tags((string) ($co['description'] ?? '')));
    if ($rawDesc !== '') {
        $rawDesc = trim(preg_replace('/\s+/u', ' ', $rawDesc));
        if (mb_strlen($rawDesc) > 120) {
            $cut     = mb_substr($rawDesc, 0, 120);
            $lastSp  = mb_strrpos($cut, ' ');
            $rawDesc = ($lastSp !== false ? mb_substr($cut, 0, $lastSp) : $cut) . '…';
        }
        $subtitle = $rawDesc;
    }

    Response::success([
        'type'       => 'company',
        'uuid'       => $co['uuid'],
        'name'       => $co['name'],
        'avatar'     => $co['logo'],
        'verified'   => (bool) (int) $co['is_verified'],
        // No tagline column on companies; the description is the closest
        // thing, clamped to a single card-sized line.
        'subtitle'   => $subtitle,
        'industry'   => $co['industry'] ?: null,
        'location'   => $location !== '' ? $location : null,
        'stats'      => [
            'followers' => $followers,
            'openings'  => $openings,
        ],
        'viewer'     => [
            'signed_in' => $actor !== null,
            'is_self'   => $isSelf,
            'following' => $following,
        ],
        // Companies are not messageable (messaging is user-to-user only,
        // see src/Messaging.php::requireUserActor), so the card offers
        // Follow + View openings instead — no message block here.
    ]);
}

// =====================================================================
// USER
// =====================================================================
$stmt = $pdo->prepare(
    'SELECT id, uuid, username, first_name, last_name, profile_pic,
            city, state, is_verified, is_active
     FROM users WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$u = $stmt->fetch();
if (!$u || !(int) $u['is_active']) {
    Response::error('Not found.', 404);
}

$userId    = (int) $u['id'];
$viewerId  = Auth::userId();
$isSelf    = ($viewerId !== null && $viewerId === $userId);

// ---- settings: one round trip for every key the card cares about -----
$settings = [];
$ss = $pdo->prepare(
    "SELECT setting_key, setting_value FROM user_settings
     WHERE user_id = ?
       AND setting_key IN ('discoverable','show_city','hide_all_scores','hide_follow_lists')"
);
$ss->execute([$userId]);
foreach ($ss->fetchAll() as $row) {
    $settings[$row['setting_key']] = $row['setting_value'];
}

// Discoverability gate. Absent row = discoverable (matches
// api/search/global.php). The owner always sees their own card.
$discoverable = ($settings['discoverable'] ?? '1') !== '0';
if (!$discoverable && !$isSelf) {
    Response::error('Not found.', 404);
}

$showCity        = ($settings['show_city'] ?? '1') !== '0';        // default ON
$hideAllScores   = ($settings['hide_all_scores'] ?? '0') === '1';  // default off
$hideFollowLists = ($settings['hide_follow_lists'] ?? '0') === '1';// default off

// ---- current role: title @ company ----------------------------------
$headline = null;
$cur = $pdo->prepare(
    'SELECT title, company_name FROM job_history
     WHERE user_id = ? AND end_date IS NULL
     ORDER BY start_date DESC LIMIT 1'
);
$cur->execute([$userId]);
if ($job = $cur->fetch()) {
    $headline = trim($job['title'] ?? '');
    if (!empty($job['company_name'])) {
        $headline = $headline !== ''
            ? $headline . ' @ ' . $job['company_name']
            : $job['company_name'];
    }
    if ($headline === '') $headline = null;
}

// ---- top score ------------------------------------------------------
// Owner sees everything; visitors see nothing when hide_all_scores is
// set, and never see individually hidden targets.
$score = null;
if (!$hideAllScores || $isSelf) {
    $sql = "
        SELECT s.target_type, s.target_value, s.score_value
        FROM scores s
        JOIN (
            SELECT target_type, target_value, MAX(created_at) AS latest
            FROM scores WHERE user_id = ? GROUP BY target_type, target_value
        ) m ON m.target_type = s.target_type
           AND m.target_value = s.target_value
           AND m.latest = s.created_at
        WHERE s.user_id = ?";
    if (!$isSelf) {
        $sql .= " AND NOT EXISTS (
                     SELECT 1 FROM hidden_scores h
                     WHERE h.user_id = ?
                       AND h.target_type = s.target_type
                       AND h.target_value = s.target_value)";
    }
    $sql .= ' ORDER BY s.score_value DESC LIMIT 1';

    $sc = $pdo->prepare($sql);
    $sc->execute($isSelf ? [$userId, $userId] : [$userId, $userId, $userId]);
    if ($row = $sc->fetch()) {
        $score = [
            'target_type'  => $row['target_type'],
            'target_value' => $row['target_value'],
            'value'        => (int) $row['score_value'],
        ];
    }
}

// ---- follower / following counts ------------------------------------
$stats = null;
if (!$hideFollowLists || $isSelf) {
    $fc = $pdo->prepare(
        "SELECT COUNT(*) FROM follows WHERE target_type = 'user' AND target_id = ?"
    );
    $fc->execute([$userId]);
    $followers = (int) $fc->fetchColumn();

    $gc = $pdo->prepare(
        "SELECT COUNT(*) FROM follows WHERE follower_type = 'user' AND follower_id = ?"
    );
    $gc->execute([$userId]);
    $followingCount = (int) $gc->fetchColumn();

    $stats = ['followers' => $followers, 'following' => $followingCount];
}

// ---- viewer relationship --------------------------------------------
$following = false;
$followsMe = false;
$blocked   = false;

if ($actor !== null && !$isSelf) {
    $fs = $pdo->prepare(
        "SELECT 1 FROM follows
         WHERE follower_type = ? AND follower_id = ?
           AND target_type = 'user' AND target_id = ? LIMIT 1"
    );
    $fs->execute([$actor['type'], $actor['id'], $userId]);
    $following = (bool) $fs->fetch();

    if ($actor['type'] === 'user') {
        $bs = $pdo->prepare(
            "SELECT 1 FROM follows
             WHERE follower_type = 'user' AND follower_id = ?
               AND target_type = 'user' AND target_id = ? LIMIT 1"
        );
        $bs->execute([$userId, $actor['id']]);
        $followsMe = (bool) $bs->fetch();

        $blocked = Messaging::isBlockedEitherWay('user', (int) $actor['id'], 'user', $userId);
    }
}

// ---- message availability -------------------------------------------
// Mirrors api/messages/start.php: user actors only, never yourself,
// never across a block. Anything unavailable is reported with a reason
// so the card can grey the button out and say why.
$canMessage    = false;
$messageReason = null;

if ($actor === null) {
    $messageReason = 'Sign in to send a message';
} elseif ($isSelf) {
    $messageReason = null;                      // button hidden entirely
} elseif ($actor['type'] !== 'user') {
    $messageReason = 'Companies cannot send messages';
} elseif ($blocked) {
    $messageReason = 'Messaging unavailable';   // deliberately non-specific:
                                                // never reveal who blocked whom
} else {
    $canMessage = true;
}

// Existing conversation, so the card can say "Message" vs "Request".
$conversationPending = false;
if ($canMessage) {
    $conv = Messaging::findConversation('user', (int) $actor['id'], 'user', $userId);
    if ($conv !== null && ($conv['status'] ?? '') === 'pending') {
        $conversationPending = true;
    }
}

$fullName = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
$location = trim(implode(', ', array_filter([
    $u['city'] ?: null,
    $u['state'] ?: null,
])));

Response::success([
    'type'      => 'user',
    'uuid'      => $u['uuid'],
    'name'      => $fullName !== '' ? $fullName : $u['username'],
    'username'  => $u['username'],
    'avatar'    => $u['profile_pic'],
    'verified'  => (bool) (int) $u['is_verified'],
    'headline'  => $headline,
    'location'  => ($showCity && $location !== '') ? $location : null,
    'score'     => $score,
    'stats'     => $stats,
    'viewer'    => [
        'signed_in'  => $actor !== null,
        'is_self'    => $isSelf,
        'following'  => $following,
        'follows_me' => $followsMe,
        'blocked'    => $blocked,
    ],
    'message'   => [
        'available' => $canMessage,
        'pending'   => $conversationPending,
        'reason'    => $messageReason,
    ],
]);
