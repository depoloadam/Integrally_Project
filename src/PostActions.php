<?php

// =====================================================================
// FILE: src/PostActions.php
// Per-post viewer actions: save, hide, mute-author, report.
// All keyed on the polymorphic actor (user OR company), same shape as
// post_likes / post_comments. Requires migration_post_actions.sql.
// =====================================================================

require_once __DIR__ . '/Database.php';

class PostActions
{
    /** Allowed report reasons (machine key => human label). */
    public const REASONS = [
        'spam'          => 'Spam or misleading',
        'harassment'    => 'Harassment or hate',
        'nudity'        => 'Nudity or sexual content',
        'violence'      => 'Violence or dangerous content',
        'misinfo'       => 'False information',
        'ip'            => 'Intellectual-property violation',
        'other'         => 'Something else',
    ];

    // ---- saves --------------------------------------------------------

    public static function save(array $actor, int $postId): void
    {
        $pdo = Database::conn();
        $pdo->prepare(
            'INSERT IGNORE INTO post_saves (actor_type, actor_id, post_id) VALUES (?, ?, ?)'
        )->execute([$actor['type'], $actor['id'], $postId]);
    }

    public static function unsave(array $actor, int $postId): void
    {
        Database::conn()->prepare(
            'DELETE FROM post_saves WHERE actor_type = ? AND actor_id = ? AND post_id = ?'
        )->execute([$actor['type'], $actor['id'], $postId]);
    }

    // ---- hides --------------------------------------------------------

    public static function hide(array $actor, int $postId): void
    {
        Database::conn()->prepare(
            'INSERT IGNORE INTO post_hides (actor_type, actor_id, post_id) VALUES (?, ?, ?)'
        )->execute([$actor['type'], $actor['id'], $postId]);
    }

    public static function unhide(array $actor, int $postId): void
    {
        Database::conn()->prepare(
            'DELETE FROM post_hides WHERE actor_type = ? AND actor_id = ? AND post_id = ?'
        )->execute([$actor['type'], $actor['id'], $postId]);
    }

    // ---- author mutes ("show fewer like this") ------------------------

    public static function muteAuthor(array $actor, string $authorType, int $authorId): void
    {
        Database::conn()->prepare(
            'INSERT IGNORE INTO author_mutes (actor_type, actor_id, author_type, author_id)
             VALUES (?, ?, ?, ?)'
        )->execute([$actor['type'], $actor['id'], $authorType, $authorId]);
    }

    public static function unmuteAuthor(array $actor, string $authorType, int $authorId): void
    {
        Database::conn()->prepare(
            'DELETE FROM author_mutes
             WHERE actor_type = ? AND actor_id = ? AND author_type = ? AND author_id = ?'
        )->execute([$actor['type'], $actor['id'], $authorType, $authorId]);
    }

    // ---- reports ------------------------------------------------------

    /** True if $reason is a known report key. */
    public static function isValidReason(string $reason): bool
    {
        return isset(self::REASONS[$reason]);
    }

    public static function report(array $actor, int $postId, string $reason, ?string $detail): void
    {
        Database::conn()->prepare(
            'INSERT INTO post_reports (post_id, actor_type, actor_id, reason, detail)
             VALUES (:pid, :at, :ai, :r, :d)
             ON DUPLICATE KEY UPDATE reason = VALUES(reason), detail = VALUES(detail),
                                     status = "open", created_at = CURRENT_TIMESTAMP'
        )->execute([
            ':pid' => $postId, ':at' => $actor['type'], ':ai' => $actor['id'],
            ':r'   => $reason, ':d'  => ($detail !== null && $detail !== '' ? $detail : null),
        ]);
    }

    // ---- decoration + feed filtering ----------------------------------

    /**
     * For a batch of post ids, which has THIS actor saved?
     * Returns [post_id => true]. Used to set the "Saved" menu state.
     */
    public static function savedMap(?array $actor, array $postIds): array
    {
        $out = [];
        if ($actor === null || !$postIds) return $out;
        $ids = array_values(array_unique(array_map('intval', $postIds)));
        $place = implode(',', array_fill(0, count($ids), '?'));
        $stmt = Database::conn()->prepare(
            "SELECT post_id FROM post_saves
             WHERE actor_type = ? AND actor_id = ? AND post_id IN ($place)"
        );
        $stmt->execute(array_merge([$actor['type'], $actor['id']], $ids));
        foreach ($stmt->fetchAll() as $r) $out[(int) $r['post_id']] = true;
        return $out;
    }

    /**
     * SQL fragment + params that EXCLUDE, for the given actor:
     *   - posts they've hidden
     *   - posts whose author they've muted
     * Designed to be dropped into a feed WHERE clause. `$postAlias` is the
     * alias of the `posts` table in the host query (e.g. 'p'). Returns
     * ['sql' => ' AND ...', 'params' => [...]]; both empty when no actor.
     *
     * Callers append $frag['sql'] to their WHERE and splice $frag['params']
     * into the bound params IN THE SAME POSITION the fragment appears.
     */
    public static function feedExclusion(?array $actor, string $postAlias = 'p'): array
    {
        if ($actor === null) return ['sql' => '', 'params' => []];
        // The author_type comparison joins two ENUM columns that could, on
        // some installs, carry different collations (e.g. a posts table
        // left at general_ci while newer tables are unicode_ci). Force a
        // common collation so the '=' can't raise "illegal mix of
        // collations". Harmless when they already match.
        $coll = 'utf8mb4_unicode_ci';
        $sql =
            " AND NOT EXISTS (
                SELECT 1 FROM post_hides ph
                WHERE ph.actor_type = ? AND ph.actor_id = ? AND ph.post_id = {$postAlias}.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM author_mutes am
                WHERE am.actor_type = ? AND am.actor_id = ?
                  AND am.author_type = {$postAlias}.author_type COLLATE {$coll}
                  AND am.author_id   = {$postAlias}.author_id
              )";
        $params = [$actor['type'], $actor['id'], $actor['type'], $actor['id']];
        return ['sql' => $sql, 'params' => $params];
    }
}
