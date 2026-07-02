<?php


// =====================================================================
// FILE: api/company/me.php
// GET — the currently logged-in company, or 401.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

$companyId = Auth::requireCompany();
$pdo  = Database::conn();
$stmt = $pdo->prepare(
    'SELECT id, uuid, email, name, industry, city, state, country,
            logo, website, description, is_verified, allow_employee_listing,
            created_at
     FROM companies WHERE id = ? LIMIT 1'
);
$stmt->execute([$companyId]);
$company = $stmt->fetch();

if (!$company) {
    Auth::logoutCompany();
    Response::error('Company authentication required.', 401);
}
$company['id'] = (int) $company['id'];
Response::success($company);