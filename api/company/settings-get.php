<?php

// =====================================================================
// FILE: api/company/settings-get.php
// GET  -> all of the logged-in company's settings as a key->value object.
// Optionally ?key=foo to fetch a single value.
// Mirrors api/settings/get.php for companies.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$companyId = Auth::requireCompany();
$pdo       = Database::conn();

$single = trim($_GET['key'] ?? '');

if ($single !== '') {
    $stmt = $pdo->prepare(
        'SELECT setting_value FROM company_settings WHERE company_id = ? AND setting_key = ? LIMIT 1'
    );
    $stmt->execute([$companyId, $single]);
    $row = $stmt->fetch();
    Response::success([$single => $row ? $row['setting_value'] : null]);
}

$stmt = $pdo->prepare('SELECT setting_key, setting_value FROM company_settings WHERE company_id = ?');
$stmt->execute([$companyId]);

$out = [];
foreach ($stmt->fetchAll() as $r) {
    $out[$r['setting_key']] = $r['setting_value'];
}
Response::success($out);
