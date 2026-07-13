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
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$in       = Response::input();
$login    = trim($in['login'] ?? '');        // email or username
$password = (string) ($in['password'] ?? '');

if ($login === '' || $password === '') {
    Response::error('Login and password are required.', 422);
}

// ---- brute-force guard ------------------------------------------------
// TWO buckets, because the two attacks look different:
//
//   by IP      — one machine trying many passwords (or many accounts)
//   by account — a botnet trying ONE account from many IPs, which the
//                IP bucket alone would never see (credential stuffing)
//
// Both are checked WITHOUT incrementing. The counter only moves on a
// FAILED attempt, so signing in correctly never spends your own budget,
// and a success wipes the slate (see forgive() below). Someone who
// fat-fingers their password four times and then gets it right is not
// left one typo away from a 15-minute lockout.
$ipKey      = RateLimit::actorKey();                          // ip:<hash> — nobody is logged in here
$accountKey = RateLimit::subjectKey('login', $login);

RateLimit::blockIfExhausted('auth_login_fail', $ipKey);
RateLimit::blockIfExhausted('auth_login_fail', $accountKey);

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
    // Only failures cost the caller. Charge BOTH buckets.
    RateLimit::penalise('auth_login_fail', $ipKey);
    RateLimit::penalise('auth_login_fail', $accountKey);
    Response::error('Invalid login or password.', 401);
}

if ((int) $user['is_active'] !== 1) {
    // Correct password, disabled account — not an attack, so no penalty.
    Response::error('This account is disabled.', 403);
}

// Correct credentials: reset the counters so honest fumbling doesn't
// accumulate toward a lockout.
RateLimit::forgive('auth_login_fail', $ipKey);
RateLimit::forgive('auth_login_fail', $accountKey);

Auth::login((int) $user['id']);

Response::success([
    'id'       => (int) $user['id'],
    'uuid'     => $user['uuid'],
    'email'    => $user['email'],
    'username' => $user['username'],
]);