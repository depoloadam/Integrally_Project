<?php


// =====================================================================
// FILE: api/company/update.php
// POST — update the logged-in company's own fields.
// Body: any of { name, industry, city, state, country, website, description }
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$in        = Response::input();
$pdo       = Database::conn();

$allowed = ['name', 'industry', 'city', 'state', 'country', 'website', 'description'];
$sets = []; $params = [];
foreach ($allowed as $f) {
    if (array_key_exists($f, $in)) {
        $v = trim((string) $in[$f]);
        if ($f === 'name') {
            if ($v === '' || strlen($v) > 150) {
                Response::error('Company name must be 1–150 characters.', 422);
            }
            $sets[] = 'name = ?'; $params[] = $v;
        } else {
            $sets[] = "$f = ?"; $params[] = ($v === '' ? null : $v);
        }
    }
}
if (!$sets) Response::error('No valid fields to update.', 422);

$params[] = $companyId;
$pdo->prepare('UPDATE companies SET ' . implode(', ', $sets) . ' WHERE id = ?')
    ->execute($params);

$stmt = $pdo->prepare(
    'SELECT uuid, name, email, industry, city, state, country, logo, website, description
     FROM companies WHERE id = ? LIMIT 1'
);
$stmt->execute([$companyId]);
Response::success($stmt->fetch());