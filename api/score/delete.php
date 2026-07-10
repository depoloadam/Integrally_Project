<?php

// =====================================================================
// FILE: api/score/delete.php
// POST { id: <score id> }
// Permanently deletes ONE of the caller's own score rows.
//
// Unlike hide.php (which only suppresses a target from the public
// profile while keeping the data), this removes the row from the
// scores table entirely. Ownership is enforced: a user can only delete
// score rows where scores.user_id matches their session.
//
// If deleting a row leaves NO remaining scores for that (target_type,
// target_value), any stale hidden_scores entry for that target is
// cleaned up too, so a later re-score doesn't come back pre-hidden.
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

$id = isset($in['id']) ? (int) $in['id'] : 0;
if ($id <= 0) {
    Response::error('A valid score id is required.', 422);
}
// scope 'one' (default) deletes just this row; 'all' deletes every score
// the caller has for the same (target_type, target_value) target.
$scope = ($in['scope'] ?? 'one') === 'all' ? 'all' : 'one';

// Fetch the row first so we can (a) verify ownership and (b) know the
// target for the hidden_scores cleanup below.
$row = $pdo->prepare('SELECT id, user_id, target_type, target_value FROM scores WHERE id = ? LIMIT 1');
$row->execute([$id]);
$score = $row->fetch();

if (!$score) {
    Response::error('Score not found.', 404);
}
if ((int) $score['user_id'] !== $userId) {
    Response::error('You can only remove your own scores.', 403);
}

$pdo->beginTransaction();
try {
    if ($scope === 'all') {
        // Remove the entire history for this target.
        $del = $pdo->prepare(
            'DELETE FROM scores WHERE user_id = ? AND target_type = ? AND target_value = ?'
        );
        $del->execute([$userId, $score['target_type'], $score['target_value']]);
        $deleted = $del->rowCount();
    } else {
        $del = $pdo->prepare('DELETE FROM scores WHERE id = ? AND user_id = ?');
        $del->execute([$id, $userId]);
        $deleted = $del->rowCount();
    }

    // Any remaining rows for this same target?
    $rem = $pdo->prepare(
        'SELECT COUNT(*) FROM scores WHERE user_id = ? AND target_type = ? AND target_value = ?'
    );
    $rem->execute([$userId, $score['target_type'], $score['target_value']]);
    $remaining = (int) $rem->fetchColumn();

    // If none remain, drop any lingering hidden flag for that target.
    if ($remaining === 0) {
        $clean = $pdo->prepare(
            'DELETE FROM hidden_scores WHERE user_id = ? AND target_type = ? AND target_value = ?'
        );
        $clean->execute([$userId, $score['target_type'], $score['target_value']]);
    }

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    Response::error('Could not remove the score.', 500);
}

Response::success([
    'id'                   => $id,
    'scope'                => $scope,
    'deleted'              => $deleted,
    'target_type'          => $score['target_type'],
    'target_value'         => $score['target_value'],
    'remaining_for_target' => $remaining,
]);
