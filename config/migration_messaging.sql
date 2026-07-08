-- =====================================================================
-- FILE: config/migration_messaging.sql
-- Private messaging (v1: user <-> user; schema is polymorphic so
-- companies can be enabled later with NO further migration).
--
-- Run this ONCE in phpMyAdmin before deploying the messaging drop.
-- Covers Part 1 (conversations/requests/unread) AND Part 2
-- (read receipts, delete-own-message, block/mute) so you only run
-- a single migration for the whole feature.
-- =====================================================================

-- One row per private conversation between exactly two actors.
-- status: 'pending' = message request awaiting the recipient,
--         'accepted' = normal open conversation.
CREATE TABLE IF NOT EXISTS conversations (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  status          ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
  initiator_type  ENUM('user','company') NOT NULL,
  initiator_id    INT UNSIGNED NOT NULL,
  last_message_at DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_last_message (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The two participants of each conversation (polymorphic actors).
-- last_read_message_id powers unread counts + read receipts.
-- muted suppresses message notifications for that participant only.
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id      INT UNSIGNED NOT NULL,
  actor_type           ENUM('user','company') NOT NULL,
  actor_id             INT UNSIGNED NOT NULL,
  last_read_message_id INT UNSIGNED NULL,
  muted                TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, actor_type, actor_id),
  KEY idx_actor (actor_type, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Individual messages. deleted_at = soft delete ("delete own message"):
-- the row stays so the thread keeps its shape, body is hidden on read.
CREATE TABLE IF NOT EXISTS messages (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id INT UNSIGNED NOT NULL,
  sender_type     ENUM('user','company') NOT NULL,
  sender_id       INT UNSIGNED NOT NULL,
  body            TEXT NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_conversation (conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Blocks: blocker refuses all messaging to/from blocked (both directions
-- are refused at send time). Polymorphic on both sides.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_type ENUM('user','company') NOT NULL,
  blocker_id   INT UNSIGNED NOT NULL,
  blocked_type ENUM('user','company') NOT NULL,
  blocked_id   INT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_type, blocker_id, blocked_type, blocked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
