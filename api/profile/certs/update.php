<?php


// =====================================================================
// FILE: api/profile/certs/update.php
// POST { id*, name?, issuer?, issue_date?, expiry_date?, credential_id? }
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

$check = $pdo->prepare('SELECT id FROM certifications WHERE id = ? AND user_id = ? LIMIT 1');
$check->execute([$id, $userId]);
if (!$check->fetch()) Response::error('Record not found.', 404);

$allowed = ['name', 'issuer', 'issue_date', 'expiry_date', 'credential_id'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        if ($f === 'name') {
            $v = trim((string) $in[$f]);
            if ($v === '') Response::error('Name cannot be empty.', 422);
            $sets[] = 'name = ?'; $params[] = $v;
        } else {
            $v = trim((string) $in[$f]);
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}
if (!$sets) Response::error('No fields to update.', 422);

$params[] = $id;
$pdo->prepare('UPDATE certifications SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

Response::success(['updated' => $id]);