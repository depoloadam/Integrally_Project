<?php

// =====================================================================
// FILE: api/applications/for-job.php
// GET ?job_uuid=<uuid>&sort=<score|newest|oldest|name|resume|status>
// Company-only, owner-only. Lists applicants for one of the company's
// own jobs. Each applicant carries a FIXED score_rank (computed from the
// score ordering, scoreless = null) that stays stable no matter which
// display sort is chosen. Default sort is score (highest first).
// Withdrawn applications are included but flagged, so the pipeline
// history stays honest. View-only — v1 has no accept/reject.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Applications.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();

$jobUuid = trim($_GET['job_uuid'] ?? '');
if ($jobUuid === '') Response::error('A job_uuid is required.', 422);

// Load + ownership check.
$stmt = $pdo->prepare(
    'SELECT id, company_id, title, status, accept_until FROM jobs WHERE uuid = ? LIMIT 1'
);
$stmt->execute([$jobUuid]);
$job = $stmt->fetch();
if (!$job) Response::error('Job not found.', 404);
if ((int) $job['company_id'] !== $companyId) {
    Response::error('You do not own this job posting.', 403);
}

// Display sort — whitelisted. The list is always FETCHED in score order so
// the fixed score_rank (below) is authoritative; the chosen sort only
// reorders the rows for display. Unknown/missing values fall back to score.
$SORTS = ['score', 'newest', 'oldest', 'name', 'resume', 'status'];
$sort  = in_array($_GET['sort'] ?? '', $SORTS, true) ? $_GET['sort'] : 'score';

// Applicants + candidate display info. NATIVE channel only — external
// marks are the candidate's personal off-platform tracking records and
// are never surfaced to the company. Fetched score-first so score_rank is
// stable regardless of the display sort.
// Probe for the AI column once (migration_application_ai_score.sql).
$hasAi = false;
try { $pdo->query('SELECT ai_score FROM job_applications LIMIT 1'); $hasAi = true; }
catch (\PDOException $e) { $hasAi = false; }
$aiSel = $hasAi ? 'a.ai_score,' : '';

$stmt = $pdo->prepare(
    "SELECT a.uuid, a.status, a.created_at, a.withdrawn_at,
            a.score_value, $aiSel a.resume_file, a.resume_name,
            u.uuid AS user_uuid, u.username, u.first_name, u.last_name,
            u.profile_pic
     FROM job_applications a
     JOIN users u ON u.id = a.user_id
     WHERE a.job_id = ? AND a.apply_channel = 'native'
     ORDER BY (a.score_value IS NULL), a.score_value DESC, a.created_at ASC, a.uuid ASC"
);
$stmt->execute([(int) $job['id']]);

$applicants = [];
$counts = ['submitted' => 0, 'withdrawn' => 0, 'expired' => 0];
$rank = 0;
foreach ($stmt->fetchAll() as $r) {
    $derived = Applications::derivedStatus(
        ['status' => $r['status'], 'created_at' => $r['created_at']],
        ['status' => $job['status'], 'accept_until' => $job['accept_until']]
    );
    if (isset($counts[$derived])) $counts[$derived]++;

    // Fixed score rank, assigned in the score-first fetch order above, so
    // it stays meaningful no matter how the list is later re-sorted for
    // display. Scoreless applicants get no rank.
    $scoreRank = $r['score_value'] !== null ? ++$rank : null;

    $full = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
    $applicants[] = [
        'uuid'         => $r['uuid'],
        'status'       => $derived,
        'status_label' => Applications::statusLabel($derived),
        'applied_at'   => $r['created_at'],
        'score_value'  => $r['score_value'] !== null ? (float) $r['score_value'] : null,
        'ai_score'     => (isset($r['ai_score']) && $r['ai_score'] !== null) ? (float) $r['ai_score'] : null,
        'score_rank'   => $scoreRank,
        'has_resume'   => !empty($r['resume_file']),
        'candidate' => [
            'uuid'      => $r['user_uuid'],
            'username'  => $r['username'],
            'full_name' => $full !== '' ? $full : null,
            'avatar'    => $r['profile_pic'],
        ],
    ];
}

// Apply the display sort in PHP. Status is a DERIVED value (not a stored
// column), so it can't be a plain SQL ORDER BY — sorting here keeps every
// mode consistent and correct. Comparators fall back to score_rank so the
// order is fully deterministic (never depends on fetch happenstance).
$byScoreRank = function ($a, $b) {
    // Scoreless (null rank) always sinks below ranked applicants.
    if ($a['score_rank'] === null && $b['score_rank'] === null) {
        return strcmp($a['uuid'], $b['uuid']);
    }
    if ($a['score_rank'] === null) return 1;
    if ($b['score_rank'] === null) return -1;
    return $a['score_rank'] <=> $b['score_rank'];
};
$nameKey = function ($a) {
    $n = $a['candidate']['full_name'] ?? $a['candidate']['username'] ?? '';
    return mb_strtolower(trim($n));
};
// Status display priority: active first, then withdrawn/expired/unavailable.
$statusOrder = ['submitted' => 0, 'withdrawn' => 1, 'expired' => 2, 'job_unavailable' => 3];

usort($applicants, function ($a, $b) use ($sort, $byScoreRank, $nameKey, $statusOrder) {
    switch ($sort) {
        case 'newest':
            $c = strcmp($b['applied_at'], $a['applied_at']);
            return $c !== 0 ? $c : $byScoreRank($a, $b);
        case 'oldest':
            $c = strcmp($a['applied_at'], $b['applied_at']);
            return $c !== 0 ? $c : $byScoreRank($a, $b);
        case 'name':
            $c = strcmp($nameKey($a), $nameKey($b));
            return $c !== 0 ? $c : $byScoreRank($a, $b);
        case 'resume':
            // Applicants with a resume first; tiebreak by score rank.
            $c = ($b['has_resume'] ? 1 : 0) <=> ($a['has_resume'] ? 1 : 0);
            return $c !== 0 ? $c : $byScoreRank($a, $b);
        case 'status':
            $c = ($statusOrder[$a['status']] ?? 9) <=> ($statusOrder[$b['status']] ?? 9);
            return $c !== 0 ? $c : $byScoreRank($a, $b);
        case 'score':
        default:
            return $byScoreRank($a, $b);
    }
});

Response::success([
    'job' => [
        'uuid'   => $jobUuid,
        'title'  => $job['title'],
        'status' => $job['status'],
    ],
    'sort'       => $sort,
    'counts'     => $counts,
    'applicants' => $applicants,
]);
