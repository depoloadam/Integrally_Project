<?php

// =====================================================================
// FILE: api/auth/register.php
// ---------------------------------------------------------------------
// POST /api/auth/register
// Body (JSON): { email, username, password, city?, state?, country? }
// Creates a user, logs them in, returns the safe public profile.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

// Only accept POST.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle account farming. Keyed on IP — nobody is signed in yet.
RateLimit::guard('auth_register');

$in = Response::input();

// --- Validate required fields ----------------------------------------
$email    = trim($in['email']    ?? '');
$username = trim($in['username'] ?? '');
$password = (string) ($in['password'] ?? '');
$confirm  = (string) ($in['confirm_password'] ?? '');

// Name fields (first + last required; middle initial optional).
$firstName = trim($in['first_name'] ?? '');
$lastName  = trim($in['last_name'] ?? '');
$middleInitial = trim($in['middle_initial'] ?? '');

// A leading '@' on the username is display-only; strip it if the client
// sent it, so we store the bare username.
$username = ltrim($username, '@');

if ($email === '' || $username === '' || $password === '' || $firstName === '' || $lastName === '') {
    Response::error('First name, last name, email, username, and password are required.', 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    Response::error('Please enter a valid email address.', 422);
}
if (strlen($username) > 50) {
    Response::error('Username is too long (50 characters max).', 422);
}
if (strlen($middleInitial) > 5) {
    Response::error('Middle initial is too long.', 422);
}
if ($password !== $confirm) {
    Response::error('Passwords do not match.', 422);
}

// --- Server-side password complexity (mirrors the client checklist) --
// Never trust the client for security rules — enforce here too.
if (strlen($password) < 8) {
    Response::error('Password must be at least 8 characters.', 422);
}
if (!preg_match('/[A-Z]/', $password)) {
    Response::error('Password must include a capital letter.', 422);
}
if (!preg_match('/[0-9]/', $password)) {
    Response::error('Password must include a number.', 422);
}
if (!preg_match('/[^A-Za-z0-9]/', $password)) {
    Response::error('Password must include a special character.', 422);
}

// Optional location — country only for now (city/state dropped from form).
$country = trim($in['country'] ?? '') ?: null;
$city    = trim($in['city']    ?? '') ?: null;   // still accepted if sent
$state   = trim($in['state']   ?? '') ?: null;

$pdo = Database::conn();

// --- Enforce one-account-per-email (and unique username) -------------
$stmt = $pdo->prepare(
    'SELECT email, username FROM users WHERE email = ? OR username = ? LIMIT 1'
);
$stmt->execute([$email, $username]);
if ($existing = $stmt->fetch()) {
    if (strcasecmp($existing['email'], $email) === 0) {
        Response::error('An account with that email already exists.', 409);
    }
    Response::error('That username is taken.', 409);
}

// --- Create the user --------------------------------------------------
$uuid = Auth::uuid();
$hash = Auth::hashPassword($password);

try {
    $stmt = $pdo->prepare(
        'INSERT INTO users
           (uuid, email, username, first_name, middle_initial, last_name,
            password_hash, city, state, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $uuid, $email, $username,
        $firstName, ($middleInitial === '' ? null : $middleInitial), $lastName,
        $hash, $city, $state, $country,
    ]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        Response::error('That email or username is already in use.', 409);
    }
    throw $e;
}

$userId = (int) $pdo->lastInsertId();

// Email verification is not wired to a mail service yet, so mark new
// accounts verified for now. Flip this to a real flow once email works.
try {
    $pdo->prepare(
        "INSERT INTO user_settings (user_id, setting_key, setting_value)
         VALUES (?, 'email_verified', '1')
         ON DUPLICATE KEY UPDATE setting_value = '1'"
    )->execute([$userId]);
} catch (Throwable $e) { /* non-fatal */ }

// Log the new user straight in.
Auth::login($userId);

// Return a SAFE view — never the password hash.
Response::success([
    'id'         => $userId,
    'uuid'       => $uuid,
    'email'      => $email,
    'username'   => $username,
    'first_name' => $firstName,
    'last_name'  => $lastName,
    'country'    => $country,
], 201);
