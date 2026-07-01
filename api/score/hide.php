<?php

// =====================================================================
// FILE: api/score/hide.php
// ---------------------------------------------------------------------
// POST { target_type, target_value, hide: true|false }
// Hides (or unhides) ONE score target from showing on the caller's
// public profile. Keyed off (target_type, target_value) rather than a
// specific scores.id, since scores get recalculated over time and new
// rows are inserted for the same target.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$userId = Auth::requireLogin();
$in     = Response::input();
$pdo    = Database::conn();

$targetType  = trim($in['target_type'] ?? '');
$targetValue = trim($in['target_value'] ?? '');
$hide        = !empty($in['hide']);

$validTypes = ['job_title', 'skill', 'field'];
if (!in_array($targetType, $validTypes, true) || $targetValue === '') {
    Response::error('A valid target_type and target_value are required.', 422);
}

if ($hide) {
    $stmt = $pdo->prepare(
        'INSERT INTO hidden_scores (user_id, target_type, target_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE target_type = VALUES(target_type)'
    );
    $stmt->execute([$userId, $targetType, $targetValue]);
} else {
    $stmt = $pdo->prepare(
        'DELETE FROM hidden_scores WHERE user_id = ? AND target_type = ? AND target_value = ?'
    );
    $stmt->execute([$userId, $targetType, $targetValue]);
}

Response::success(['target_type' => $targetType, 'target_value' => $targetValue, 'hidden' => $hide]);
