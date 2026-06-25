<?php


// =====================================================================
// FILE: api/company/register.php
// POST { email*, name*, password*, industry?, city?, state?, country?,
//        website?, description? }
// Creates a company account and logs it in (company session).
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$in = Response::input();

$email    = trim($in['email'] ?? '');
$name     = trim($in['name'] ?? '');
$password = (string) ($in['password'] ?? '');

if ($email === '' || $name === '' || $password === '') {
    Response::error('Email, company name, and password are required.', 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    Response::error('Please enter a valid email address.', 422);
}
if (strlen($password) < 8) {
    Response::error('Password must be at least 8 characters.', 422);
}
if (strlen($name) > 150) {
    Response::error('Company name is too long (150 max).', 422);
}

$pdo = Database::conn();

// One account per email (company side). DB UNIQUE is the real guard;
// this is for a friendly message.
$stmt = $pdo->prepare('SELECT id FROM companies WHERE email = ? LIMIT 1');
$stmt->execute([$email]);
if ($stmt->fetch()) {
    Response::error('A company account with that email already exists.', 409);
}

$uuid = Auth::uuid();
$hash = Auth::hashPassword($password);

try {
    $stmt = $pdo->prepare(
        'INSERT INTO companies
           (uuid, email, name, password_hash, industry, city, state, country, website, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $uuid, $email, $name, $hash,
        trim($in['industry'] ?? '') ?: null,
        trim($in['city'] ?? '') ?: null,
        trim($in['state'] ?? '') ?: null,
        trim($in['country'] ?? '') ?: null,
        trim($in['website'] ?? '') ?: null,
        trim($in['description'] ?? '') ?: null,
    ]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        Response::error('That email is already in use.', 409);
    }
    throw $e;
}

$companyId = (int) $pdo->lastInsertId();
Auth::loginCompany($companyId);

Response::success([
    'id'    => $companyId,
    'uuid'  => $uuid,
    'email' => $email,
    'name'  => $name,
], 201);