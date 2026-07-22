<?php

// =====================================================================
// FILE: src/Endorsements.php
// ---------------------------------------------------------------------
// Skill "vouching". A user endorses a specific skill on ANOTHER user's
// profile. Endorsing is gated on a MUTUAL FOLLOW (the strongest trust
// edge in a follow-based graph): the endorser must follow the target
// AND the target must follow the endorser. This is the core anti-abuse
// property — you can't farm endorsements from throwaway accounts unless
// the target also follows each of them back.
//
// The current ScoreEngine (category-relevance-v2.2) does NOT read
// endorsements. A future v2.3 (reviewed separately) may fold a capped,
// decaying form of the count into the skills factor. Keeping the read
// helpers here means that integration has a single, tested source.
//
// Server is the enforcer. Every rule below is checked here regardless
// of what the client shows.
// =====================================================================

require_once __DIR__ . '/Database.php';

class Endorsements
{
    /**
     * Is there a mutual follow between two users? Both directions must
     * exist in `follows` with follower_type='user' and target_type='user'.
     * follows was made polymorphic on the follower side by
     * migration_company_following.sql; we scope to user<->user only.
     */
    public static function areMutual(PDO $pdo, int $a, int $b): bool
    {
        if ($a === $b) return false;
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS n FROM follows
             WHERE follower_type='user' AND target_type='user'
               AND ((follower_id = ? AND target_id = ?)
                 OR (follower_id = ? AND target_id = ?))"
        );
        $stmt->execute([$a, $b, $b, $a]);
        return (int) $stmt->fetchColumn() === 2;
    }

    /** Does this user have this skill linked on their profile? */
    public static function targetHasSkill(PDO $pdo, int $targetUserId, int $skillId): bool
    {
        $stmt = $pdo->prepare(
            'SELECT 1 FROM user_skills WHERE user_id = ? AND skill_id = ? LIMIT 1'
        );
        $stmt->execute([$targetUserId, $skillId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Add an endorsement. Returns true if a new row was inserted, false
     * if it already existed (idempotent). Caller is responsible for
     * having validated mutual-follow / skill-ownership / not-self first;
     * this method re-checks nothing so it can be reused, but the public
     * endpoint does the full gate.
     */
    public static function add(PDO $pdo, int $targetUserId, int $skillId, int $endorserUserId): bool
    {
        $stmt = $pdo->prepare(
            'INSERT IGNORE INTO skill_endorsements
               (target_user_id, skill_id, endorser_user_id)
             VALUES (?, ?, ?)'
        );
        $stmt->execute([$targetUserId, $skillId, $endorserUserId]);
        return $stmt->rowCount() > 0;
    }

    /** Remove an endorsement. Returns true if a row was deleted. */
    public static function remove(PDO $pdo, int $targetUserId, int $skillId, int $endorserUserId): bool
    {
        $stmt = $pdo->prepare(
            'DELETE FROM skill_endorsements
             WHERE target_user_id = ? AND skill_id = ? AND endorser_user_id = ?'
        );
        $stmt->execute([$targetUserId, $skillId, $endorserUserId]);
        return $stmt->rowCount() > 0;
    }

    /** Total endorsements for one (target, skill). */
    public static function count(PDO $pdo, int $targetUserId, int $skillId): int
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM skill_endorsements
             WHERE target_user_id = ? AND skill_id = ?'
        );
        $stmt->execute([$targetUserId, $skillId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Batch decorate a target user's skills with endorsement info.
     * Returns [skill_id => ['count' => int, 'you_endorsed' => bool]].
     *
     * $viewerUserId is the currently-signed-in user (or null when not a
     * user session); 'you_endorsed' is always false when null or when
     * the viewer is the target (you can't endorse yourself).
     */
    public static function forTargetSkills(
        PDO $pdo, int $targetUserId, array $skillIds, ?int $viewerUserId
    ): array {
        $skillIds = array_values(array_unique(array_map('intval', $skillIds)));
        $out = [];
        foreach ($skillIds as $sid) $out[$sid] = ['count' => 0, 'you_endorsed' => false];
        if (!$skillIds) return $out;

        $place  = implode(',', array_fill(0, count($skillIds), '?'));

        // counts
        $params = array_merge([$targetUserId], $skillIds);
        $cs = $pdo->prepare(
            "SELECT skill_id, COUNT(*) c FROM skill_endorsements
             WHERE target_user_id = ? AND skill_id IN ($place)
             GROUP BY skill_id"
        );
        $cs->execute($params);
        foreach ($cs->fetchAll() as $r) {
            $out[(int) $r['skill_id']]['count'] = (int) $r['c'];
        }

        // which of these the viewer has endorsed
        if ($viewerUserId !== null && $viewerUserId !== $targetUserId) {
            $params = array_merge([$targetUserId, $viewerUserId], $skillIds);
            $ys = $pdo->prepare(
                "SELECT skill_id FROM skill_endorsements
                 WHERE target_user_id = ? AND endorser_user_id = ? AND skill_id IN ($place)"
            );
            $ys->execute($params);
            foreach ($ys->fetchAll() as $r) {
                $out[(int) $r['skill_id']]['you_endorsed'] = true;
            }
        }

        return $out;
    }

    /**
     * List the endorsers of each of a target user's skills. Returns
     *   [skill_id => [ ['uuid'=>, 'username'=>, 'profile_pic'=>, 'created_at'=>], ... ]]
     * ordered newest-first within each skill. Only active endorsers are
     * included. Access control (mutual-follow / owner) is the CALLER's
     * responsibility — this method reveals identities and must never be
     * exposed without the gate.
     */
    public static function endorsersForTargetSkills(
        PDO $pdo, int $targetUserId, array $skillIds
    ): array {
        $skillIds = array_values(array_unique(array_map('intval', $skillIds)));
        $out = [];
        foreach ($skillIds as $sid) $out[$sid] = [];
        if (!$skillIds) return $out;

        $place  = implode(',', array_fill(0, count($skillIds), '?'));
        $params = array_merge([$targetUserId], $skillIds);

        $stmt = $pdo->prepare(
            "SELECT se.skill_id, se.created_at,
                    u.uuid, u.username, u.profile_pic
             FROM skill_endorsements se
             JOIN users u ON u.id = se.endorser_user_id
             WHERE se.target_user_id = ? AND se.skill_id IN ($place)
               AND u.is_active = 1
             ORDER BY se.created_at DESC, se.id DESC"
        );
        $stmt->execute($params);
        foreach ($stmt->fetchAll() as $r) {
            $out[(int) $r['skill_id']][] = [
                'uuid'        => $r['uuid'],
                'username'    => $r['username'],
                'profile_pic' => $r['profile_pic'],
                'created_at'  => $r['created_at'],
            ];
        }
        return $out;
    }
}
