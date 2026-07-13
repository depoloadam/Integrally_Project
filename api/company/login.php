<?php


// =====================================================================
// FILE: api/company/login.php
// POST { login*, password* }   // login = company email
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$in       = Response::input();
$login    = trim($in['login'] ?? '');
$password = (string) ($in['password'] ?? '');

if ($login === '' || $password === '') {
    Response::error('Login and password are required.', 422);
}

// Brute-force guard. Two buckets — by IP (one machine, many guesses) and
// by account (many machines, one company). Counters move only on FAILURE;
// see api/auth/login.php for the full rationale.
$ipKey      = RateLimit::actorKey();
$accountKey = RateLimit::subjectKey('company_login', $login);

RateLimit::blockIfExhausted('company_login_fail', $ipKey);
RateLimit::blockIfExhausted('company_login_fail', $accountKey);

$pdo  = Database::conn();
$stmt = $pdo->prepare(
    'SELECT id, uuid, email, name, password_hash, is_active
     FROM companies WHERE email = ? LIMIT 1'
);
$stmt->execute([$login]);
$company = $stmt->fetch();

// Generic message — don't reveal which company emails exist.
if (!$company || !Auth::verifyPassword($password, $company['password_hash'])) {
    RateLimit::penalise('company_login_fail', $ipKey);
    RateLimit::penalise('company_login_fail', $accountKey);
    Response::error('Invalid login or password.', 401);
}
if ((int) $company['is_active'] !== 1) {
    // Correct password, disabled account — not an attack, no penalty.
    Response::error('This company account is disabled.', 403);
}

RateLimit::forgive('company_login_fail', $ipKey);
RateLimit::forgive('company_login_fail', $accountKey);

Auth::loginCompany((int) $company['id']);

Response::success([
    'id'    => (int) $company['id'],
    'uuid'  => $company['uuid'],
    'email' => $company['email'],
    'name'  => $company['name'],
]);
