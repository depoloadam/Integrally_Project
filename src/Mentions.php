<?php

// =====================================================================
// FILE: src/Mentions.php
// ---------------------------------------------------------------------
// @mentions in post bodies and comments.
//
// The body stores plain "@username" text — whatever the author typed.
// This class is the bridge between that text and the post_mentions
// table, and it is the ONLY place mention parsing lives, so posts and
// comments cannot drift apart.
//
// The public entry point is sync(), not add(). Sync computes the mention
// set for a body, diffs it against what is already recorded, inserts
// what is new, removes what is gone, and notifies ONLY the newly added.
// On create the "already recorded" set is empty, so it behaves exactly
// like an append — but if post editing is added later, the same call
// handles it correctly: adding a mention on edit notifies that person
// once, and re-saving does not re-notify anyone.
// =====================================================================

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/RichText.php';
require_once __DIR__ . '/Social.php';

class Mentions
{
    /**
     * Usernames are VARCHAR(50); the pattern matches the character set
     * the signup flow allows. The leading (?<![\w@]) stops us matching
     * inside an email address (foo@bar.com) or mid-word (a@b), and the
     * trailing boundary keeps trailing punctuation out of the capture
     * so "@alice." and "@alice," resolve to "alice".
     */
    private const PATTERN = '/(?<![\w@])@([A-Za-z0-9_.-]{1,50})/u';

    /** Hard ceiling per body, so one post can't fan out to hundreds. */
    public const MAX_PER_BODY = 20;

    /**
     * Extract candidate usernames from a body. Accepts rich-text HTML or
     * plain text; HTML is flattened first so a mention split across
     * formatting tags (e.g. "@ali<strong>ce</strong>") is still seen as
     * one token, and so tag attributes can never be parsed as mentions.
     *
     * Returns lowercased, de-duplicated usernames in first-seen order.
     */
    public static function parse(string $body): array
    {
        $text = RichText::toPlain($body);
        if (trim($text) === '') return [];

        if (!preg_match_all(self::PATTERN, $text, $m)) return [];

        $seen = [];
        foreach ($m[1] as $raw) {
            // Trailing dots/hyphens are almost always sentence punctuation
            // rather than part of the handle.
            $name = rtrim($raw, '.-');
            if ($name === '') continue;
            $key = mb_strtolower($name);
            if (!isset($seen[$key])) $seen[$key] = true;
            if (count($seen) >= self::MAX_PER_BODY) break;
        }
        return array_keys($seen);
    }

    /**
     * Resolve usernames to active, mentionable user accounts.
     *
     * Respects the same discoverability rule as search and hover cards:
     * a user with discoverable='0' has opted out of being surfaced, so
     * they are not resolvable by an @mention either. Their handle simply
     * renders as plain text.
     *
     * $excludeUserId drops the author, so self-mentions never resolve —
     * they stay literal text and generate nothing.
     *
     * Returns [ lowercased_username => ['id' => int, 'username' => string] ].
     */
    public static function resolve(array $usernames, int $excludeUserId = 0): array
    {
        if (!$usernames) return [];

        $pdo   = Database::conn();
        $place = implode(',', array_fill(0, count($usernames), '?'));

        // LOWER() on both sides so the match is case-insensitive
        // regardless of the column's collation.
        $sql = "SELECT u.id, u.username
                FROM users u
                LEFT JOIN user_settings us
                       ON us.user_id = u.id AND us.setting_key = 'discoverable'
                WHERE u.is_active = 1
                  AND (us.setting_value IS NULL OR us.setting_value <> '0')
                  AND LOWER(u.username) IN ($place)";
        $params = array_map('mb_strtolower', $usernames);

        if ($excludeUserId > 0) {
            $sql .= ' AND u.id <> ?';
            $params[] = $excludeUserId;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[mb_strtolower($r['username'])] = [
                'id'       => (int) $r['id'],
                'username' => $r['username'],
            ];
        }
        return $out;
    }

    /**
     * Reconcile the mention rows for one body and notify newly-mentioned
     * users.
     *
     * @param int      $postId     always required (a comment mention is
     *                             still anchored to its post so that
     *                             notification enrichment can resolve a
     *                             post snippet).
     * @param int|null $commentId  null for a post body.
     * @param string   $body       raw body as stored.
     * @param array    $actor      ['type'=>'user'|'company','id'=>int]
     *
     * @return array the user ids newly mentioned (notified).
     */
    public static function sync(
        int $postId,
        ?int $commentId,
        string $body,
        array $actor
    ): array {
        $pdo = Database::conn();

        // Self-mentions are excluded outright, per product decision:
        // mentioning yourself records nothing and notifies nobody. Only
        // meaningful when the author is a user — a company session has
        // no username to mention.
        $excludeId = ($actor['type'] === 'user') ? (int) $actor['id'] : 0;

        $resolved = self::resolve(self::parse($body), $excludeId);
        $wanted   = [];
        foreach ($resolved as $r) $wanted[$r['id']] = true;

        // What is already recorded for this exact body?
        if ($commentId === null) {
            $q = $pdo->prepare(
                "SELECT mentioned_id FROM post_mentions
                 WHERE post_id = ? AND comment_id IS NULL AND mentioned_type = 'user'"
            );
            $q->execute([$postId]);
        } else {
            $q = $pdo->prepare(
                "SELECT mentioned_id FROM post_mentions
                 WHERE comment_id = ? AND mentioned_type = 'user'"
            );
            $q->execute([$commentId]);
        }
        $existing = [];
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $id) $existing[(int) $id] = true;

        $toAdd    = array_diff_key($wanted, $existing);
        $toRemove = array_diff_key($existing, $wanted);

        // --- remove mentions that are no longer in the text ------------
        // (No-op on create. Only reachable once editing exists.)
        if ($toRemove) {
            $ids   = array_keys($toRemove);
            $place = implode(',', array_fill(0, count($ids), '?'));
            if ($commentId === null) {
                $del = $pdo->prepare(
                    "DELETE FROM post_mentions
                     WHERE post_id = ? AND comment_id IS NULL
                       AND mentioned_type = 'user' AND mentioned_id IN ($place)"
                );
                $del->execute(array_merge([$postId], $ids));
            } else {
                $del = $pdo->prepare(
                    "DELETE FROM post_mentions
                     WHERE comment_id = ?
                       AND mentioned_type = 'user' AND mentioned_id IN ($place)"
                );
                $del->execute(array_merge([$commentId], $ids));
            }

            // Withdraw the corresponding notifications. Someone removed
            // from a post should not keep a bell item pointing at text
            // that no longer names them.
            foreach ($ids as $uid) {
                if ($commentId === null) {
                    $dn = $pdo->prepare(
                        "DELETE FROM notifications
                         WHERE recipient_type = 'user' AND recipient_id = ?
                           AND type = 'mention' AND post_id = ? AND comment_id IS NULL"
                    );
                    $dn->execute([$uid, $postId]);
                } else {
                    $dn = $pdo->prepare(
                        "DELETE FROM notifications
                         WHERE recipient_type = 'user' AND recipient_id = ?
                           AND type = 'mention' AND comment_id = ?"
                    );
                    $dn->execute([$uid, $commentId]);
                }
            }
        }

        // --- insert new mentions and notify ----------------------------
        if (!$toAdd) return [];

        $ins = $pdo->prepare(
            "INSERT IGNORE INTO post_mentions
               (post_id, comment_id, mentioned_type, mentioned_id)
             VALUES (?, ?, 'user', ?)"
        );

        $notified = [];
        foreach (array_keys($toAdd) as $uid) {
            $ins->execute([$postId, $commentId, $uid]);
            // INSERT IGNORE returns 0 rows if the unique key already
            // caught it (a concurrent double-submit); don't notify twice.
            if ($ins->rowCount() === 0) continue;

            // notify() no-ops when the recipient is the actor and honours
            // the recipient's notify_mention preference.
            Social::notify(
                'user', $uid,
                $actor['type'], (int) $actor['id'],
                'mention', $postId, $commentId
            );
            $notified[] = $uid;
        }
        return $notified;
    }

    /**
     * Rewrite resolved "@username" occurrences in a stored body into
     * mention links, leaving unresolved handles as plain text.
     *
     * Done server-side, at serialization, because post bodies are
     * already sanitized HTML that the client injects as trusted markup —
     * so this is the one place that reaches every consumer (feed/main,
     * feed/explore, feed/company, posts/get, comment-list) without
     * threading a mentions array through each of them.
     *
     * $people is the list from forPosts()/forComments() for THIS body.
     * Only those usernames are linked, so an @handle that never resolved
     * (deleted account, non-discoverable, a bare email fragment) can
     * never be turned into a link by a later rename.
     *
     * The emitted anchor carries data-hover-card / data-hover-uuid, so
     * mentions get profile hover previews for free.
     *
     * $isHtml distinguishes post bodies (sanitized HTML) from comment
     * bodies (plain text, escaped by the client). For plain text we
     * return a marker-free plain string and let the caller escape; see
     * linkPlain() below.
     */
    public static function linkHtml(?string $body, array $people): string
    {
        $body = (string) $body;
        if ($body === '' || !$people) return $body;

        $byLower = [];
        foreach ($people as $p) $byLower[mb_strtolower($p['username'])] = $p;

        // Split on tags so replacements only ever touch text nodes —
        // never an attribute value or a tag name.
        $parts = preg_split('/(<[^>]*>)/', $body, -1, PREG_SPLIT_DELIM_CAPTURE);
        $out   = '';
        foreach ($parts as $part) {
            if ($part === '') continue;
            if ($part[0] === '<') { $out .= $part; continue; }

            $out .= preg_replace_callback(
                self::PATTERN,
                function ($m) use ($byLower) {
                    $name = rtrim($m[1], '.-');
                    $tail = substr($m[1], strlen($name));   // punctuation we trimmed
                    $key  = mb_strtolower($name);
                    if (!isset($byLower[$key])) return $m[0];   // unresolved -> literal
                    $p = $byLower[$key];
                    return '<a href="#user/' . htmlspecialchars($p['uuid'], ENT_QUOTES, 'UTF-8') . '"'
                         . ' class="in-mention"'
                         . ' data-hover-card="user"'
                         . ' data-hover-uuid="' . htmlspecialchars($p['uuid'], ENT_QUOTES, 'UTF-8') . '">'
                         . '@' . htmlspecialchars($p['username'], ENT_QUOTES, 'UTF-8')
                         . '</a>' . $tail;
                },
                $part
            );
        }
        return $out;
    }

    /**
     * Same as linkHtml() but for plain-text bodies (comments). The input
     * is escaped here, since the result is HTML the client injects
     * directly rather than escaping itself.
     */
    public static function linkPlain(?string $body, array $people): string
    {
        $escaped = htmlspecialchars((string) $body, ENT_QUOTES, 'UTF-8');
        if ($escaped === '' || !$people) return $escaped;
        return self::linkHtml($escaped, $people);
    }

    /**
     * The mentioned users for a set of post ids, for render-time linking.
     * Returns [ post_id => [ ['id','uuid','username'], ... ] ], comment
     * mentions excluded (comments are fetched separately).
     */
    public static function forPosts(array $postIds): array
    {
        $postIds = array_values(array_unique(array_map('intval', $postIds)));
        if (!$postIds) return [];

        $pdo   = Database::conn();
        $place = implode(',', array_fill(0, count($postIds), '?'));
        $stmt  = $pdo->prepare(
            "SELECT pm.post_id, u.id, u.uuid, u.username
             FROM post_mentions pm
             JOIN users u ON u.id = pm.mentioned_id
             WHERE pm.mentioned_type = 'user'
               AND pm.comment_id IS NULL
               AND pm.post_id IN ($place)"
        );
        $stmt->execute($postIds);

        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[(int) $r['post_id']][] = [
                'id'       => (int) $r['id'],
                'uuid'     => $r['uuid'],
                'username' => $r['username'],
            ];
        }
        return $out;
    }

    /**
     * The mentioned users for a set of comment ids.
     * Returns [ comment_id => [ ['id','uuid','username'], ... ] ].
     */
    public static function forComments(array $commentIds): array
    {
        $commentIds = array_values(array_unique(array_map('intval', $commentIds)));
        if (!$commentIds) return [];

        $pdo   = Database::conn();
        $place = implode(',', array_fill(0, count($commentIds), '?'));
        $stmt  = $pdo->prepare(
            "SELECT pm.comment_id, u.id, u.uuid, u.username
             FROM post_mentions pm
             JOIN users u ON u.id = pm.mentioned_id
             WHERE pm.mentioned_type = 'user'
               AND pm.comment_id IN ($place)"
        );
        $stmt->execute($commentIds);

        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[(int) $r['comment_id']][] = [
                'id'       => (int) $r['id'],
                'uuid'     => $r['uuid'],
                'username' => $r['username'],
            ];
        }
        return $out;
    }
}
