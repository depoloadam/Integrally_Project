<?php


// =====================================================================
// FILE: api/profile/education/update.php
// POST { id*, institution?, degree?, field?, start_year?, end_year? }
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

$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('A valid record id is required.', 422);

$check = $pdo->prepare('SELECT id FROM education WHERE id = ? AND user_id = ? LIMIT 1');
$check->execute([$id, $userId]);
if (!$check->fetch()) Response::error('Record not found.', 404);

$allowed = ['institution', 'degree', 'field', 'start_year', 'end_year'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        if ($f === 'start_year' || $f === 'end_year') {
            $sets[] = "$f = ?";
            $params[] = !empty($in[$f]) ? (int) $in[$f] : null;
        } else {
            $v = trim((string) $in[$f]);
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}
if (!$sets) Response::error('No fields to update.', 422);

$params[] = $id;
$pdo->prepare('UPDATE education SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

Response::success(['updated' => $id]);

