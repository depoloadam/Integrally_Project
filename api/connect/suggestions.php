<?php

// =====================================================================
// FILE: api/connect/suggestions.php
// GET ?type=all|users|companies&limit=12&offset=0
//
// Ranked "who to follow" suggestions for the Connect page, replacing the
// old behaviour of dumping every user in creation order. Works for a user
// session OR a company session (Social::requireActor()).
//
// Scoring is done in PHP over a bounded candidate pool rather than in one
// giant SQL query: each signal is a cheap indexed lookup, the pools are
// small, and the ranking stays readable/tunable. Already-followed
// identities and the actor itself are excluded up front.
//
// USER SUGGESTIONS — signals (see SCORES below):
//   mutual        people followed by the people you follow (strongest)
//   skill         shares one or more of your skills
//   employer      worked at a company you've worked at
//   city/state    same city (or, weaker, same state)
//   popular       follower count (mild tiebreaker, capped)
//   verified      small nudge
//
// COMPANY SUGGESTIONS — signals:
//   employer      a company you've worked at
//   mutual        followed by people you follow
//   industry      matches the industry of a company you already follow
//   city/state    same location
//   popular/verified as above
//
// Every suggestion carries a `reason` string, which the UI shows under
// the name ("2 people you follow", "Shares 3 skills", …) — an unexplained
// suggestion is just noise.
//
// Cold start: a brand-new user matches no signals. Rather than returning
// an empty list, the tail is topped up with popular + recent identities,
// flagged with reason "Popular on Integrally" / "New to Integrally".
//
// Paging ("Browse more"): the full candidate set is scored and ordered
// deterministically, then sliced by offset. Ranking is stable across
// calls because ties break on id, so page 2 never repeats page 1. The
// response carries `has_more` so the UI knows whether to keep the button.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Social.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

RateLimit::guard('search');

$actor = Social::requireActor();   // ['type' => 'user'|'company', 'id' => int]
$pdo   = Database::conn();

$type   = trim($_GET['type'] ?? 'all');
$limit  = (int) ($_GET['limit'] ?? 12);
$offset = max(0, (int) ($_GET['offset'] ?? 0));
if ($limit <= 0)  $limit = 12;
if ($limit > 30)  $limit = 30;

if (!in_array($type, ['all', 'users', 'companies'], true)) {
    Response::error("type must be 'all', 'users', or 'companies'.", 422);
}

// Signal weights. Tuned so a single mutual connection outranks any amount
// of passive similarity, and so popularity can never dominate on its own.
const SCORE_MUTUAL     = 50;   // per mutual, capped below
const SCORE_MUTUAL_CAP = 150;
const SCORE_SKILL      = 12;   // per shared skill, capped below
const SCORE_SKILL_CAP  = 48;
const SCORE_EMPLOYER   = 40;
const SCORE_INDUSTRY   = 18;
const SCORE_CITY       = 15;
const SCORE_STATE      = 6;
const SCORE_VERIFIED   = 4;
const POPULAR_CAP      = 10;   // followers contribute at most this much

// ---- what the actor already follows (excluded from suggestions) -------
$followedUsers     = [];   // user_id  => true
$followedCompanies = [];   // company_id => true
$f = $pdo->prepare(
    "SELECT target_type, target_id FROM follows
     WHERE follower_type = ? AND follower_id = ?"
);
$f->execute([$actor['type'], $actor['id']]);
foreach ($f->fetchAll() as $row) {
    if ($row['target_type'] === 'user') $followedUsers[(int) $row['target_id']] = true;
    else                                $followedCompanies[(int) $row['target_id']] = true;
}

// ---- the actor's own context (only users have skills/jobs) -----------
$myCity = $myState = null;
$mySkillIds = [];
$myEmployerNames = [];   // lowercased company names from job history
$myEmployerIds   = [];

if ($actor['type'] === 'user') {
    $me = $pdo->prepare("SELECT city, state FROM users WHERE id = ?");
    $me->execute([$actor['id']]);
    if ($row = $me->fetch()) {
        $myCity  = $row['city']  ?: null;
        $myState = $row['state'] ?: null;
    }
    $s = $pdo->prepare("SELECT skill_id FROM user_skills WHERE user_id = ?");
    $s->execute([$actor['id']]);
    $mySkillIds = array_map('intval', array_column($s->fetchAll(), 'skill_id'));

    $j = $pdo->prepare("SELECT company_name, company_id FROM job_history WHERE user_id = ?");
    $j->execute([$actor['id']]);
    foreach ($j->fetchAll() as $row) {
        if (!empty($row['company_name'])) {
            $myEmployerNames[mb_strtolower(trim($row['company_name']))] = true;
        }
        if (!empty($row['company_id'])) {
            $myEmployerIds[(int) $row['company_id']] = true;
        }
    }
} else {
    $me = $pdo->prepare("SELECT city, state FROM companies WHERE id = ?");
    $me->execute([$actor['id']]);
    if ($row = $me->fetch()) {
        $myCity  = $row['city']  ?: null;
        $myState = $row['state'] ?: null;
    }
}

// ---- mutuals: who do the people/companies I follow, follow? -----------
// One query per target type. Only follows made BY the identities I follow.
$mutualUsers     = [];   // user_id => count
$mutualCompanies = [];   // company_id => count
$followedUserIds = array_keys($followedUsers);

if ($followedUserIds) {
    $ph = implode(',', array_fill(0, count($followedUserIds), '?'));
    $m = $pdo->prepare(
        "SELECT target_type, target_id, COUNT(*) AS n
         FROM follows
         WHERE follower_type = 'user' AND follower_id IN ($ph)
         GROUP BY target_type, target_id"
    );
    $m->execute($followedUserIds);
    foreach ($m->fetchAll() as $row) {
        $id = (int) $row['target_id'];
        if ($row['target_type'] === 'user') $mutualUsers[$id]     = (int) $row['n'];
        else                                $mutualCompanies[$id] = (int) $row['n'];
    }
}

// ---- follower counts (popularity tiebreaker) -------------------------
$fc = $pdo->query(
    "SELECT target_type, target_id, COUNT(*) AS n FROM follows
     GROUP BY target_type, target_id"
)->fetchAll();
$followerCounts = ['user' => [], 'company' => []];
foreach ($fc as $row) {
    $followerCounts[$row['target_type']][(int) $row['target_id']] = (int) $row['n'];
}

$results = [];

// =====================================================================
// USERS
// =====================================================================
if ($type === 'all' || $type === 'users') {
    $excludeIds = array_keys($followedUsers);
    if ($actor['type'] === 'user') $excludeIds[] = $actor['id'];
    $excludeIds = array_values(array_unique(array_map('intval', $excludeIds)));

    $notIn = '';
    $params = [];
    if ($excludeIds) {
        $notIn = ' AND u.id NOT IN (' . implode(',', array_fill(0, count($excludeIds), '?')) . ')';
        $params = $excludeIds;
    }

    // Candidate pool, bounded. Newest first is fine — scoring reorders.
    $stmt = $pdo->prepare(
        "SELECT u.id, u.uuid, u.username, u.first_name, u.last_name,
                u.city, u.state, u.profile_pic, u.is_verified
         FROM users u
         WHERE u.is_active = 1 $notIn
         ORDER BY u.created_at DESC
         LIMIT 1000"
    );
    $stmt->execute($params);
    $candidates = $stmt->fetchAll();

    if ($candidates) {
        $ids = array_map(fn($u) => (int) $u['id'], $candidates);
        $ph  = implode(',', array_fill(0, count($ids), '?'));

        // shared skills per candidate
        $sharedSkills = [];
        if ($mySkillIds) {
            $sph = implode(',', array_fill(0, count($mySkillIds), '?'));
            $sk = $pdo->prepare(
                "SELECT user_id, COUNT(*) AS n FROM user_skills
                 WHERE user_id IN ($ph) AND skill_id IN ($sph)
                 GROUP BY user_id"
            );
            $sk->execute(array_merge($ids, $mySkillIds));
            foreach ($sk->fetchAll() as $row) {
                $sharedSkills[(int) $row['user_id']] = (int) $row['n'];
            }
        }

        // current job + shared-employer detection, one pass
        $currentJobs    = [];
        $sharedEmployer = [];
        $js = $pdo->prepare(
            "SELECT user_id, title, company_name, company_id, end_date, start_date
             FROM job_history
             WHERE user_id IN ($ph)
             ORDER BY start_date DESC"
        );
        $js->execute($ids);
        foreach ($js->fetchAll() as $j) {
            $uid = (int) $j['user_id'];
            if ($j['end_date'] === null && !isset($currentJobs[$uid])) {
                $currentJobs[$uid] = [
                    'title'   => $j['title'] ?: null,
                    'company' => $j['company_name'] ?: null,
                ];
            }
            if (!isset($sharedEmployer[$uid])) {
                $nameHit = !empty($j['company_name'])
                    && isset($myEmployerNames[mb_strtolower(trim($j['company_name']))]);
                $idHit = !empty($j['company_id'])
                    && isset($myEmployerIds[(int) $j['company_id']]);
                if ($nameHit || $idHit) {
                    $sharedEmployer[$uid] = $j['company_name'] ?: 'the same company';
                }
            }
        }

        foreach ($candidates as $u) {
            $uid   = (int) $u['id'];
            $score = 0;
            $reasons = [];   // [priority, text] — best one wins for display

            $mut = $mutualUsers[$uid] ?? 0;
            if ($mut > 0) {
                $score += min($mut * SCORE_MUTUAL, SCORE_MUTUAL_CAP);
                $reasons[] = [1, $mut === 1
                    ? 'Followed by 1 person you follow'
                    : "Followed by $mut people you follow"];
            }

            if (isset($sharedEmployer[$uid])) {
                $score += SCORE_EMPLOYER;
                $reasons[] = [2, 'Worked at ' . $sharedEmployer[$uid]];
            }

            $ss = $sharedSkills[$uid] ?? 0;
            if ($ss > 0) {
                $score += min($ss * SCORE_SKILL, SCORE_SKILL_CAP);
                $reasons[] = [3, $ss === 1 ? 'Shares a skill with you' : "Shares $ss skills with you"];
            }

            if ($myCity && $u['city'] && mb_strtolower($u['city']) === mb_strtolower($myCity)) {
                $score += SCORE_CITY;
                $reasons[] = [4, 'Near you in ' . $u['city']];
            } elseif ($myState && $u['state'] && mb_strtolower($u['state']) === mb_strtolower($myState)) {
                $score += SCORE_STATE;
                $reasons[] = [5, 'In ' . $u['state']];
            }

            if ($u['is_verified']) $score += SCORE_VERIFIED;

            $followers = $followerCounts['user'][$uid] ?? 0;
            $score += min($followers, POPULAR_CAP);

            // Cold-start fallback reason.
            if (!$reasons) {
                $reasons[] = $followers >= 3
                    ? [8, 'Popular on Integrally']
                    : [9, 'New to Integrally'];
            }

            usort($reasons, fn($a, $b) => $a[0] <=> $b[0]);
            $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));

            $results[] = [
                'kind'      => 'user',
                'uuid'      => $u['uuid'],
                'title'     => $u['username'],
                'subtitle'  => $name !== '' ? $name : null,
                'location'  => trim(($u['city'] ?? '') . ($u['state'] ? ', ' . $u['state'] : ''), ', ') ?: null,
                'image'     => $u['profile_pic'] ?: null,
                'verified'  => (bool) $u['is_verified'],
                'job'       => $currentJobs[$uid] ?? null,
                'following' => false,          // followed identities are excluded
                'reason'    => $reasons[0][1],
                '_score'    => $score,
                '_id'       => $uid,
            ];
        }
    }
}

// =====================================================================
// COMPANIES
// =====================================================================
if ($type === 'all' || $type === 'companies') {
    $excludeIds = array_keys($followedCompanies);
    if ($actor['type'] === 'company') $excludeIds[] = $actor['id'];
    $excludeIds = array_values(array_unique(array_map('intval', $excludeIds)));

    $notIn = '';
    $params = [];
    if ($excludeIds) {
        $notIn = ' AND c.id NOT IN (' . implode(',', array_fill(0, count($excludeIds), '?')) . ')';
        $params = $excludeIds;
    }

    $stmt = $pdo->prepare(
        "SELECT c.id, c.uuid, c.name, c.industry, c.city, c.state, c.logo, c.is_verified
         FROM companies c
         WHERE c.is_active = 1 $notIn
         ORDER BY c.created_at DESC
         LIMIT 1000"
    );
    $stmt->execute($params);
    $candidates = $stmt->fetchAll();

    // Industries of companies the actor already follows — a decent proxy
    // for "the kind of company this person cares about".
    $myIndustries = [];
    if ($followedCompanies) {
        $ph = implode(',', array_fill(0, count($followedCompanies), '?'));
        $ind = $pdo->prepare("SELECT DISTINCT industry FROM companies WHERE id IN ($ph) AND industry IS NOT NULL");
        $ind->execute(array_keys($followedCompanies));
        foreach ($ind->fetchAll() as $row) {
            $myIndustries[mb_strtolower(trim($row['industry']))] = true;
        }
    }

    foreach ($candidates as $c) {
        $cid   = (int) $c['id'];
        $score = 0;
        $reasons = [];

        // Did the actor work here? Match on linked id first, then name.
        $employerHit = isset($myEmployerIds[$cid])
            || (!empty($c['name']) && isset($myEmployerNames[mb_strtolower(trim($c['name']))]));
        if ($employerHit) {
            $score += SCORE_EMPLOYER;
            $reasons[] = [1, 'You worked here'];
        }

        $mut = $mutualCompanies[$cid] ?? 0;
        if ($mut > 0) {
            $score += min($mut * SCORE_MUTUAL, SCORE_MUTUAL_CAP);
            $reasons[] = [2, $mut === 1
                ? 'Followed by 1 person you follow'
                : "Followed by $mut people you follow"];
        }

        if (!empty($c['industry']) && isset($myIndustries[mb_strtolower(trim($c['industry']))])) {
            $score += SCORE_INDUSTRY;
            $reasons[] = [3, 'In ' . $c['industry']];
        }

        if ($myCity && $c['city'] && mb_strtolower($c['city']) === mb_strtolower($myCity)) {
            $score += SCORE_CITY;
            $reasons[] = [4, 'Near you in ' . $c['city']];
        } elseif ($myState && $c['state'] && mb_strtolower($c['state']) === mb_strtolower($myState)) {
            $score += SCORE_STATE;
            $reasons[] = [5, 'In ' . $c['state']];
        }

        if ($c['is_verified']) $score += SCORE_VERIFIED;

        $followers = $followerCounts['company'][$cid] ?? 0;
        $score += min($followers, POPULAR_CAP);

        if (!$reasons) {
            $reasons[] = $followers >= 3
                ? [8, 'Popular on Integrally']
                : [9, 'New to Integrally'];
        }

        usort($reasons, fn($a, $b) => $a[0] <=> $b[0]);

        $results[] = [
            'kind'      => 'company',
            'uuid'      => $c['uuid'],
            'title'     => $c['name'],
            'subtitle'  => $c['industry'] ?: null,
            'location'  => trim(($c['city'] ?? '') . ($c['state'] ? ', ' . $c['state'] : ''), ', ') ?: null,
            'image'     => $c['logo'] ?: null,
            'verified'  => (bool) $c['is_verified'],
            'following' => false,
            'reason'    => $reasons[0][1],
            '_score'    => $score,
            '_id'       => $cid,
        ];
    }
}

// ---- rank, slice, ship -----------------------------------------------
// Sort is DETERMINISTIC: score first, then kind, then id. Without the id
// tiebreaker, equal-scoring rows could swap order between calls and
// "Browse more" would repeat or skip people across pages.
usort($results, function ($a, $b) {
    return [$b['_score'], $a['kind'], $a['_id']] <=> [$a['_score'], $b['kind'], $b['_id']];
});

// Build the FULL ordered list first, then slice by offset — so page 2 is
// simply the next window of the same ranking.
if ($type === 'all') {
    $users     = array_values(array_filter($results, fn($r) => $r['kind'] === 'user'));
    $companies = array_values(array_filter($results, fn($r) => $r['kind'] === 'company'));
    $ordered = [];
    $ui = $ci = 0;
    // 2 users : 1 company keeps people primary without burying companies.
    while ($ui < count($users) || $ci < count($companies)) {
        for ($k = 0; $k < 2 && $ui < count($users); $k++) {
            $ordered[] = $users[$ui++];
        }
        if ($ci < count($companies)) {
            $ordered[] = $companies[$ci++];
        }
    }
    $results = $ordered;
}

$totalAvailable = count($results);
$page = array_slice($results, $offset, $limit);
$hasMore = ($offset + count($page)) < $totalAvailable;

foreach ($page as &$r) { unset($r['_score'], $r['_id']); }
unset($r);

Response::success([
    'results'  => array_values($page),
    'offset'   => $offset,
    'limit'    => $limit,
    'total'    => $totalAvailable,
    'has_more' => $hasMore,
]);
