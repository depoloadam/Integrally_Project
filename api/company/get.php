<?php


// =====================================================================
// FILE: api/company/get.php
// GET ?uuid=<uuid>  -> PUBLIC company profile (anyone can view).
// Mirrors the user profile pattern: private fields (email) hidden
// unless the logged-in company is viewing itself.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo  = Database::conn();
$uuid = trim($_GET['uuid'] ?? '');

if ($uuid === '') {
    // No uuid -> must be a logged-in company viewing itself.
    $companyId = Auth::companyId();
    if ($companyId === null) {
        Response::error('Provide a uuid, or log in as a company.', 400);
    }
    $stmt = $pdo->prepare('SELECT * FROM companies WHERE id = ? LIMIT 1');
    $stmt->execute([$companyId]);
} else {
    $stmt = $pdo->prepare('SELECT * FROM companies WHERE uuid = ? LIMIT 1');
    $stmt->execute([$uuid]);
}

$company = $stmt->fetch();
if (!$company) Response::error('Company not found.', 404);

$viewerCompanyId = Auth::companyId();
$isOwner = ($viewerCompanyId !== null && (int) $company['id'] === $viewerCompanyId);

$out = [
    'uuid'        => $company['uuid'],
    'name'        => $company['name'],
    'industry'    => $company['industry'],
    'city'        => $company['city'],
    'state'       => $company['state'],
    'country'     => $company['country'],
    'logo'        => $company['logo'],
    'website'     => $company['website'],
    'description' => $company['description'],
    'is_verified' => (int) $company['is_verified'],
    'is_owner'    => $isOwner,
];
if ($isOwner) {
    $out['email'] = $company['email'];
}

Response::success($out);