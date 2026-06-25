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
    'SELECT id, title, company_name, company_id, start_date, end_date, description
     FROM job_history
     WHERE user_id = ?
     ORDER BY (end_date IS NULL) DESC, end_date DESC, start_date DESC'
);
$stmt->execute([$userId]);
Response::success($stmt->fetchAll());