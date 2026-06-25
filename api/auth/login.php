<?php

// =====================================================================
// FILE: api/auth/login.php
// ---------------------------------------------------------------------
// POST /api/auth/login
// Body (JSON): { login, password }   // 'login' = email OR username
// Verifies credentials and starts a session.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$in       = Response::input();
$login    = trim($in['login'] ?? '');        // email or username
$password = (string) ($in['password'] ?? '');

if ($login === '' || $password === '') {
    Response::error('Login and password are required.', 422);
}

$pdo = Database::conn();

// Look up by email OR username in one query.
$stmt = $pdo->prepare(
    'SELECT id, uuid, email, username, password_hash, is_active
     FROM users
     WHERE email = ? OR username = ?
     LIMIT 1'
);
$stmt->execute([$login, $login]);
$user = $stmt->fetch();

// Use a single generic message for both "no such user" and "wrong
// password" so we don't reveal which emails/usernames exist.
if (!$user || !Auth::verifyPassword($password, $user['password_hash'])) {
    Response::error('Invalid login or password.', 401);
}

if ((int) $user['is_active'] !== 1) {
    Response::error('This account is disabled.', 403);
}

Auth::login((int) $user['id']);

Response::success([
    'id'       => (int) $user['id'],
    'uuid'     => $user['uuid'],
    'email'    => $user['email'],
    'username' => $user['username'],
]);