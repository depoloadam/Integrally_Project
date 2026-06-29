<?php
// =====================================================================
// PASS 1: STRUCTURED RECORD TABLES
//   job_history · education · certifications
//
// All three share the same shape:
//   list   -> GET   ?uuid=<uuid>   (public)  OR  none (own, logged in)
//   add    -> POST                 (own)
//   update -> POST  { id, ...}     (own; ownership verified)
//   delete -> POST  { id }         (own; ownership verified)
//
// Every write re-checks that the row belongs to the logged-in user,
// so nobody can edit another person's records by guessing IDs.
// =====================================================================


// =====================================================================
// FILE: api/profile/jobs/list.php
// GET  ?uuid=<uuid>  -> that user's job history (public)
// GET  (no uuid, logged in) -> your own job history
// =====================================================================

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/Response.php';
require_once __DIR__ . '/../../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');

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
    'SELECT jh.id, jh.title, jh.company_name, jh.company_id,
            jh.start_date, jh.end_date, jh.description,
            c.uuid AS company_uuid, c.name AS linked_company_name,
            c.allow_employee_listing
     FROM job_history jh
     LEFT JOIN companies c ON c.id = jh.company_id AND c.is_active = 1
     WHERE jh.user_id = ?
     ORDER BY (jh.end_date IS NULL) DESC, jh.end_date DESC, jh.start_date DESC'
);
$stmt->execute([$userId]);

// Only expose the link if the company still allows being listed.
$rows = array_map(function ($r) {
    $linked = $r['company_id'] && $r['company_uuid'] && (int) $r['allow_employee_listing'] === 1;
    return [
        'id'           => (int) $r['id'],
        'title'        => $r['title'],
        'company_name' => $r['company_name'],
        'start_date'   => $r['start_date'],
        'end_date'     => $r['end_date'],
        'description'  => $r['description'],
        'company_uuid' => $linked ? $r['company_uuid'] : null,
    ];
}, $stmt->fetchAll());

Response::success($rows);