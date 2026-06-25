<?php

// =====================================================================
// FILE: api/settings/get.php
// GET  -> all of the logged-in user's settings as a key->value object.
// Optionally ?key=foo to fetch a single value.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$pdo    = Database::conn();

$single = trim($_GET['key'] ?? '');

if ($single !== '') {
    $stmt = $pdo->prepare(
        'SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ? LIMIT 1'
    );
    $stmt->execute([$userId, $single]);
    $row = $stmt->fetch();
    Response::success([$single => $row ? $row['setting_value'] : null]);
}

// All settings as a flat object.
$stmt = $pdo->prepare('SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?');
$stmt->execute([$userId]);

$out = [];
foreach ($stmt->fetchAll() as $r) {
    $out[$r['setting_key']] = $r['setting_value'];
}
Response::success($out);
