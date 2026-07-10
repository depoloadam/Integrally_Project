<?php

// =====================================================================
// FILE: api/applications/detail.php
// GET ?uuid=<application uuid>
// Company-only, owner-only. Full detail for one application: the
// candidate's answers (labelled against the job's form), the score
// snapshot + breakdown, and resume metadata (download via
// resume.php). View-only.
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

$uuid = trim($_GET['uuid'] ?? '');
if ($uuid === '') Response::error('An application uuid is required.', 422);

$stmt = $pdo->prepare(
    'SELECT a.*, j.uuid AS job_uuid, j.title AS job_title, j.status AS job_status,
            j.accept_until, j.company_id, j.apply_form,
            u.uuid AS user_uuid, u.username, u.first_name, u.last_name,
            u.profile_pic, u.city, u.state, u.country
     FROM job_applications a
     JOIN jobs j  ON j.id = a.job_id
     JOIN users u ON u.id = a.user_id
     WHERE a.uuid = ? LIMIT 1'
);
$stmt->execute([$uuid]);
$a = $stmt->fetch();
if (!$a) Response::error('Application not found.', 404);
if ((int) $a['company_id'] !== $companyId) {
    Response::error('You do not own this application.', 403);
}
// External marks are candidate-only tracking records — never company-viewable.
if (($a['apply_channel'] ?? 'native') === 'external') {
    Response::error('Application not found.', 404);
}

// Pair up the job's form questions with the snapshotted answers.
$form    = Applications::normalizeForm($a['apply_form']);
$answers = $a['answers'] ? json_decode($a['answers'], true) : [];
$qa = [];
foreach ($form['questions'] as $q) {
    $qa[] = [
        'label'  => $q['label'],
        'type'   => $q['type'],
        'answer' => $answers[$q['key']] ?? null,
    ];
}

$derived = Applications::derivedStatus(
    ['status' => $a['status'], 'created_at' => $a['created_at']],
    ['status' => $a['job_status'], 'accept_until' => $a['accept_until']]
);

$full = trim(($a['first_name'] ?? '') . ' ' . ($a['last_name'] ?? ''));
$loc  = array_filter([$a['city'], $a['state'], $a['country']]);

// ---------------------------------------------------------------------
// Related self-scores: the applicant's OWN Score Me results, shown under
// the application snapshot. Ranked: relevant-to-this-job first (matching
// title or job category), high→low, then their highest other scores —
// top 3 overall. Latest score per target only.
//
// Privacy: a candidate who applied has opted into evaluation, but we
// still honor their hide choices. Hidden individual scores and the
// hide-all-scores flag are respected, AND a dedicated opt-out
// ('share_scores_with_companies' = '0') suppresses them entirely.
// ---------------------------------------------------------------------
$relatedScores = [];
$applicantId   = (int) $a['user_id'];

require_once __DIR__ . '/../../src/JobCatalog.php';

$setStmt = $pdo->prepare(
    "SELECT setting_key, setting_value FROM user_settings
     WHERE user_id = ? AND setting_key IN ('hide_all_scores','share_scores_with_companies','share_hidden_scores_with_companies')"
);
$setStmt->execute([$applicantId]);
$settings = [];
foreach ($setStmt->fetchAll() as $row) $settings[$row['setting_key']] = $row['setting_value'];

$hideAll  = ($settings['hide_all_scores'] ?? '0') === '1';
// Default ON: only an explicit '0' opts out.
$shareOff = ($settings['share_scores_with_companies'] ?? '1') === '0';
// Nested opt-in (default OFF): also surface scores the applicant hid.
$shareHidden = ($settings['share_hidden_scores_with_companies'] ?? '0') === '1';

if (!$hideAll && !$shareOff) {
    // Latest score per (target_type, target_value) for this applicant.
    $sc = $pdo->prepare(
        "SELECT s.target_type, s.target_value, s.score_value, s.created_at
         FROM scores s
         JOIN (
            SELECT target_type, target_value, MAX(created_at) AS latest
            FROM scores WHERE user_id = ?
            GROUP BY target_type, target_value
         ) m ON m.target_type = s.target_type
            AND m.target_value = s.target_value
            AND m.latest = s.created_at
         WHERE s.user_id = ?"
    );
    $sc->execute([$applicantId, $applicantId]);
    $allScores = $sc->fetchAll();

    // Hidden targets to exclude.
    $hid = $pdo->prepare('SELECT target_type, target_value FROM hidden_scores WHERE user_id = ?');
    $hid->execute([$applicantId]);
    $hidden = [];
    foreach ($hid->fetchAll() as $h) $hidden[$h['target_type'] . '|' . $h['target_value']] = true;

    // Determine this job's category once for relevance testing.
    $jobCat = JobCatalog::categoryForTitle($a['job_title'] ?? '');

    $rows = [];
    foreach ($allScores as $r) {
        $isHidden = isset($hidden[$r['target_type'] . '|' . $r['target_value']]);
        // Hidden scores are excluded unless the applicant opted to share them.
        if ($isHidden && !$shareHidden) continue;

        // Relevance: same title (case-insensitive) or same resolved category.
        $relevant = false;
        if (strcasecmp(trim($r['target_value']), trim($a['job_title'] ?? '')) === 0) {
            $relevant = true;
        } elseif ($jobCat !== null) {
            $tc = JobCatalog::categoryForTitle($r['target_value']);
            if ($tc !== null && $tc === $jobCat) $relevant = true;
        }

        $rows[] = [
            'target_type'  => $r['target_type'],
            'target_value' => $r['target_value'],
            'score_value'  => (float) $r['score_value'],
            'created_at'   => $r['created_at'],
            'relevant'     => $relevant,
            'hidden'       => $isHidden,
        ];
    }

    // Rank: relevant first, then by score desc within each group.
    usort($rows, function ($x, $y) {
        if ($x['relevant'] !== $y['relevant']) return $x['relevant'] ? -1 : 1;
        return $y['score_value'] <=> $x['score_value'];
    });

    $relatedScores = array_slice($rows, 0, 3);
}

Response::success([
    'uuid'           => $a['uuid'],
    'status'         => $derived,
    'status_label'   => Applications::statusLabel($derived),
    'applied_at'     => $a['created_at'],
    'withdrawn_at'   => $a['withdrawn_at'],
    'answers'        => $qa,
    'score' => [
        'value'     => $a['score_value'] !== null ? (float) $a['score_value'] : null,
        'breakdown' => $a['score_breakdown'] ? json_decode($a['score_breakdown'], true) : null,
        'algo'      => $a['score_algo'],
    ],
    'resume' => [
        'has'  => !empty($a['resume_file']),
        'name' => $a['resume_name'],
    ],
    'related_scores' => array_map(function ($r) {
        return [
            'target_type'  => $r['target_type'],
            'target_value' => $r['target_value'],
            'score_value'  => $r['score_value'],
            'relevant'     => $r['relevant'],
            'hidden'       => $r['hidden'] ?? false,
            'created_at'   => $r['created_at'],
        ];
    }, $relatedScores),
    'job' => [
        'uuid'   => $a['job_uuid'],
        'title'  => $a['job_title'],
        'status' => $a['job_status'],
    ],
    'candidate' => [
        'uuid'      => $a['user_uuid'],
        'username'  => $a['username'],
        'full_name' => $full !== '' ? $full : null,
        'avatar'    => $a['profile_pic'],
        'location'  => $loc ? implode(', ', $loc) : null,
    ],
]);
