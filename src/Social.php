<?php

// =====================================================================
// FILE: src/Social.php
// Shared helpers for likes / comments / notifications:
//   - currentActor(): who is acting (user or company), from the session
//   - notify(): insert a notification (skips self-notifications)
//   - resolveActor(): hydrate an actor's display fields (name, avatar, uuid)
// =====================================================================

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';

class Social
{
    /**
     * The current acting identity from the session.
     * Returns ['type' => 'user'|'company', 'id' => int] or null if neither.
     */
    public static function currentActor(): ?array
    {
        $uid = Auth::userId();
        if ($uid !== null) return ['type' => 'user', 'id' => $uid];
        $cid = Auth::companyId();
        if ($cid !== null) return ['type' => 'company', 'id' => $cid];
        return null;
    }

    /** Require an acting identity or 401. */
    public static function requireActor(): array
    {
        $a = self::currentActor();
        if ($a === null) {
            require_once __DIR__ . '/Response.php';
            Response::error('You must be signed in.', 401);
        }
        return $a;
    }

    /**
     * Insert a notification. No-ops when the actor is the recipient
     * (you don't get notified about your own actions).
     */
    public static function notify(
        string $recipientType, int $recipientId,
        string $actorType, int $actorId,
        string $type, ?int $postId = null, ?int $commentId = null
    ): void {
        if ($recipientType === $actorType && $recipientId === $actorId) {
            return; // don't notify yourself
        }
        // Respect the recipient's in-app notification preference for this
        // type. Unset defaults to ON, so existing users keep current behavior.
        if (!self::wantsNotification($recipientType, $recipientId, $type)) {
            return;
        }
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'INSERT INTO notifications
               (recipient_type, recipient_id, actor_type, actor_id, type, post_id, comment_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$recipientType, $recipientId, $actorType, $actorId, $type, $postId, $commentId]);
    }

    /**
     * Does this recipient want in-app notifications of the given type?
     * Reads the 'notify_<type>' key from the recipient's settings table
     * (user_settings or company_settings). Missing/unrecognized => ON,
     * so notifications are opt-out and default-on. Only known toggleable
     * types are gated; anything else always notifies.
     */
    public static function wantsNotification(string $recipientType, int $recipientId, string $type): bool
    {
        $gated = ['like', 'comment', 'follow'];
        if (!in_array($type, $gated, true)) {
            return true; // ungated type -> always notify
        }
        $pdo = Database::conn();
        $key = 'notify_' . $type;
        if ($recipientType === 'company') {
            $stmt = $pdo->prepare(
                'SELECT setting_value FROM company_settings WHERE company_id = ? AND setting_key = ? LIMIT 1'
            );
        } else {
            $stmt = $pdo->prepare(
                'SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ? LIMIT 1'
            );
        }
        $stmt->execute([$recipientId, $key]);
        $val = $stmt->fetchColumn();
        // Only an explicit '0' disables. Unset or anything else = ON.
        return $val !== '0';
    }

    /**
     * Look up a post's author as a recipient target.
     * Returns ['type' => ..., 'id' => ...] or null if the post is gone.
     */
    public static function postAuthor(int $postId): ?array
    {
        $pdo = Database::conn();
        $stmt = $pdo->prepare('SELECT author_type, author_id FROM posts WHERE id = ? LIMIT 1');
        $stmt->execute([$postId]);
        $r = $stmt->fetch();
        if (!$r) return null;
        return ['type' => $r['author_type'], 'id' => (int) $r['author_id']];
    }

    /**
     * Hydrate display info for an actor (name, username, avatar, uuid).
     * Used when returning notifications / comments to the client.
     */
    public static function actorInfo(string $type, int $id): array
    {
        $pdo = Database::conn();
        if ($type === 'company') {
            $stmt = $pdo->prepare('SELECT uuid, name, logo FROM companies WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            $r = $stmt->fetch();
            return $r ? [
                'type' => 'company',
                'uuid' => $r['uuid'],
                'name' => $r['name'],
                'avatar' => $r['logo'],
            ] : ['type' => 'company', 'uuid' => null, 'name' => 'A company', 'avatar' => null];
        }
        $stmt = $pdo->prepare('SELECT uuid, username, first_name, last_name, profile_pic FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $r = $stmt->fetch();
        if (!$r) return ['type' => 'user', 'uuid' => null, 'name' => 'A user', 'avatar' => null];
        $full = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
        return [
            'type' => 'user',
            'uuid' => $r['uuid'],
            'name' => $r['username'],
            'full_name' => $full !== '' ? $full : null,
            'avatar' => $r['profile_pic'],
        ];
    }

    /**
     * Batch-fetch engagement stats for a set of post IDs from the current
     * actor's perspective. Returns [postId => ['likes'=>n,'comments'=>n,
     * 'liked'=>bool]]. Avoids N+1 queries when decorating a feed.
     */
    public static function engagement(array $postIds, ?array $actor): array
    {
        $postIds = array_values(array_unique(array_map('intval', $postIds)));
        $out = [];
        foreach ($postIds as $pid) $out[$pid] = ['likes' => 0, 'comments' => 0, 'liked' => false];
        if (!$postIds) return $out;

        $pdo = Database::conn();
        $place = implode(',', array_fill(0, count($postIds), '?'));

        // like counts
        $lc = $pdo->prepare("SELECT post_id, COUNT(*) c FROM post_likes WHERE post_id IN ($place) GROUP BY post_id");
        $lc->execute($postIds);
        foreach ($lc->fetchAll() as $r) $out[(int) $r['post_id']]['likes'] = (int) $r['c'];

        // comment counts
        $cc = $pdo->prepare("SELECT post_id, COUNT(*) c FROM post_comments WHERE post_id IN ($place) GROUP BY post_id");
        $cc->execute($postIds);
        foreach ($cc->fetchAll() as $r) $out[(int) $r['post_id']]['comments'] = (int) $r['c'];

        // which of these the current actor has liked
        if ($actor !== null) {
            $params = array_merge([$actor['type'], $actor['id']], $postIds);
            $lq = $pdo->prepare(
                "SELECT post_id FROM post_likes
                 WHERE actor_type = ? AND actor_id = ? AND post_id IN ($place)"
            );
            $lq->execute($params);
            foreach ($lq->fetchAll() as $r) $out[(int) $r['post_id']]['liked'] = true;
        }

        return $out;
    }
}