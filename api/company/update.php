<?php


// =====================================================================
// FILE: api/company/update.php
// POST — update the logged-in company's own fields.
// Body: any of { name, industry, city, state, country, website, description }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('write');

$companyId = Auth::requireCompany();
$in        = Response::input();
$pdo       = Database::conn();

$allowed = ['name', 'industry', 'city', 'state', 'country', 'website', 'description', 'logo'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        $v = trim((string) $in[$f]);
        if ($f === 'name') {
            if ($v === '' || strlen($v) > 150) {
                Response::error('Company name must be 1–150 characters.', 422);
            }
            $sets[] = 'name = ?'; $params[] = $v;
        } elseif ($f === 'logo') {
            if ($v !== '' && !preg_match('#^https?://#i', $v) && $v[0] !== '/') {
                Response::error('logo must be a URL.', 422);
            }
            $sets[] = 'logo = ?'; $params[] = ($v === '' ? null : $v);
        } else {
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}

// Boolean toggle: whether users may list this company as their employer.
if (array_key_exists('allow_employee_listing', $in)) {
    $sets[] = 'allow_employee_listing = ?';
    $params[] = ($in['allow_employee_listing'] ? 1 : 0);
}
if (!$sets) Response::error('No valid fields to update.', 422);

$params[] = $companyId;
$pdo->prepare('UPDATE companies SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

$stmt = $pdo->prepare(
    'SELECT uuid, name, email, industry, city, state, country, logo, website, description, allow_employee_listing
     FROM companies WHERE id = ? LIMIT 1'
);
$stmt->execute([$companyId]);
Response::success($stmt->fetch());