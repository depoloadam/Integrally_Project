<?php


// =====================================================================
// FILE: api/company/login.php
// POST { login*, password* }   // login = company email
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$in       = Response::input();
$login    = trim($in['login'] ?? '');
$password = (string) ($in['password'] ?? '');

if ($login === '' || $password === '') {
    Response::error('Login and password are required.', 422);
}

$pdo  = Database::conn();
$stmt = $pdo->prepare(
    'SELECT id, uuid, email, name, password_hash, is_active
     FROM companies WHERE email = ? LIMIT 1'
);
$stmt->execute([$login]);
$company = $stmt->fetch();

// Generic message — don't reveal which company emails exist.
if (!$company || !Auth::verifyPassword($password, $company['password_hash'])) {
    Response::error('Invalid login or password.', 401);
}
if ((int) $company['is_active'] !== 1) {
    Response::error('This company account is disabled.', 403);
}

Auth::loginCompany((int) $company['id']);

Response::success([
    'id'    => (int) $company['id'],
    'uuid'  => $company['uuid'],
    'email' => $company['email'],
    'name'  => $company['name'],
]);
