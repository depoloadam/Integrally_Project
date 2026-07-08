<?php

// =====================================================================
// FILE: src/Messaging.php
// Shared helpers for the private messaging feature. All messaging
// endpoints include this. Actors are polymorphic ('user'|'company')
// to match the rest of the app, even though v1 only enables users.
// =====================================================================

require_once __DIR__ . '/Database.php';

class Messaging
{
    /**
     * v1 gate: only user accounts can message. Companies come later —
     * when they do, delete this check and everything else just works.
     */
    public static function requireUserActor(array $actor): void
    {
        if ($actor['type'] !== 'user') {
            require_once __DIR__ . '/Response.php';
            Response::error('Messaging is only available for user accounts right now.', 403);
        }
    }

    /**
     * Find the existing conversation between exactly these two actors.
     * Returns the conversations row (assoc) or null.
     */
    public static function findConversation(
        string $aType, int $aId, string $bType, int $bId
    ): ?array {
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'SELECT c.* FROM conversations c
             JOIN conversation_participants p1
               ON p1.conversation_id = c.id AND p1.actor_type = ? AND p1.actor_id = ?
             JOIN conversation_participants p2
               ON p2.conversation_id = c.id AND p2.actor_type = ? AND p2.actor_id = ?
             LIMIT 1'
        );
        $stmt->execute([$aType, $aId, $bType, $bId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Load a conversation and verify the given actor is a participant.
     * Errors out (403/404) if not. Returns the conversations row.
     */
    public static function requireParticipant(int $conversationId, array $actor): array
    {
        require_once __DIR__ . '/Response.php';
        $pdo = Database::conn();

        $stmt = $pdo->prepare('SELECT * FROM conversations WHERE id = ? LIMIT 1');
        $stmt->execute([$conversationId]);
        $conv = $stmt->fetch();
        if (!$conv) Response::error('Conversation not found.', 404);

        $stmt = $pdo->prepare(
            'SELECT 1 FROM conversation_participants
             WHERE conversation_id = ? AND actor_type = ? AND actor_id = ? LIMIT 1'
        );
        $stmt->execute([$conversationId, $actor['type'], $actor['id']]);
        if (!$stmt->fetch()) Response::error('You are not part of this conversation.', 403);

        return $conv;
    }

    /**
     * The OTHER participant of a two-person conversation.
     * Returns ['type' => ..., 'id' => ...] or null.
     */
    public static function otherParticipant(int $conversationId, array $actor): ?array
    {
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'SELECT actor_type, actor_id FROM conversation_participants
             WHERE conversation_id = ? AND NOT (actor_type = ? AND actor_id = ?)
             LIMIT 1'
        );
        $stmt->execute([$conversationId, $actor['type'], $actor['id']]);
        $r = $stmt->fetch();
        return $r ? ['type' => $r['actor_type'], 'id' => (int) $r['actor_id']] : null;
    }

    /**
     * Is messaging blocked between these two actors, in EITHER direction?
     * (If A blocked B, neither can message the other.)
     */
    public static function isBlockedEitherWay(
        string $aType, int $aId, string $bType, int $bId
    ): bool {
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'SELECT 1 FROM blocks
             WHERE (blocker_type = ? AND blocker_id = ? AND blocked_type = ? AND blocked_id = ?)
                OR (blocker_type = ? AND blocker_id = ? AND blocked_type = ? AND blocked_id = ?)
             LIMIT 1'
        );
        $stmt->execute([$aType, $aId, $bType, $bId, $bType, $bId, $aType, $aId]);
        return (bool) $stmt->fetch();
    }

    /**
     * Insert a message and bump the conversation's last_message_at.
     * Returns the new message id.
     */
    public static function insertMessage(int $conversationId, array $sender, string $body): int
    {
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'INSERT INTO messages (conversation_id, sender_type, sender_id, body)
             VALUES (?, ?, ?, ?)'
        );
        $stmt->execute([$conversationId, $sender['type'], $sender['id'], $body]);
        $id = (int) $pdo->lastInsertId();

        $pdo->prepare('UPDATE conversations SET last_message_at = NOW() WHERE id = ?')
            ->execute([$conversationId]);

        return $id;
    }

    /**
     * Validate + normalize an incoming message body. Errors out on
     * empty/oversized input. Plain text only in v1.
     */
    public static function cleanBody(?string $body): string
    {
        require_once __DIR__ . '/Response.php';
        $body = trim((string) $body);
        if ($body === '') Response::error('Message cannot be empty.', 422);
        if (mb_strlen($body) > 5000) Response::error('Message is too long (5000 character max).', 422);
        return $body;
    }
}
