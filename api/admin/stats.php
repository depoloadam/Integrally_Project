<?php

// =====================================================================
// FILE: api/admin/stats.php
// GET  ->  quick overview numbers for the admin dashboard.
// Admin-only.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireAdmin();
$pdo = Database::conn();

$scalar = function (string $sql) use ($pdo): int {
    $stmt = $pdo->query($sql);
    return (int) $stmt->fetch()['c'];
};

$roleCounts = [];
$stmt = $pdo->query("SELECT role, COUNT(*) AS c FROM users GROUP BY role");
foreach ($stmt->fetchAll() as $row) {
    $roleCounts[$row['role']] = (int) $row['c'];
}

Response::success([
    'total_users'      => $scalar("SELECT COUNT(*) AS c FROM users"),
    'total_companies'  => $scalar("SELECT COUNT(*) AS c FROM companies"),
    'total_posts'      => $scalar("SELECT COUNT(*) AS c FROM posts"),
    'new_posts_7d'     => $scalar("SELECT COUNT(*) AS c FROM posts WHERE created_at >= (NOW() - INTERVAL 7 DAY)"),
    'total_likes'      => $scalar("SELECT COUNT(*) AS c FROM post_likes"),
    'total_comments'   => $scalar("SELECT COUNT(*) AS c FROM post_comments"),
    'total_jobs'       => $scalar("SELECT COUNT(*) AS c FROM jobs"),
    'open_jobs'        => $scalar("SELECT COUNT(*) AS c FROM jobs WHERE status = 'open'"),
    'active_users'     => $scalar("SELECT COUNT(*) AS c FROM users WHERE is_active = 1"),
    'inactive_users'   => $scalar("SELECT COUNT(*) AS c FROM users WHERE is_active = 0"),
    'new_users_7d'     => $scalar("SELECT COUNT(*) AS c FROM users WHERE created_at >= (NOW() - INTERVAL 7 DAY)"),
    'role_counts'       => [
        'user'      => $roleCounts['user']      ?? 0,
        'moderator' => $roleCounts['moderator']  ?? 0,
        'admin'     => $roleCounts['admin']      ?? 0,
    ],
]);