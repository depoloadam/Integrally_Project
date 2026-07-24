-- =====================================================================
-- FILE: config/migration_mentions.sql
-- ---------------------------------------------------------------------
-- @mentions in posts and comments.
--
-- DESIGN. The mention lives in the body as plain "@username" text —
-- exactly what the author typed. This table is the side-index that says
-- which of those strings resolved to real accounts. That choice keeps
-- src/RichText.php untouched (its ALLOWED_TAGS has no <a>, so anchors
-- are unwrapped to text; storing mentions as markup would mean teaching
-- the sanitizer a new syntax, and a lot of correctness lives in there).
--
-- It also gives us a real relation to query: "posts that mention me" is
-- a join, not a LIKE scan over post bodies.
--
-- A row is attached to EITHER a post or a comment, never both:
--   post_id set,    comment_id NULL  -> mention in a post body
--   post_id set,    comment_id set   -> mention in a comment on that post
-- comment_id alone is never valid — post_id is always populated so that
-- notification enrichment (api/notifications/list.php resolves a post
-- snippet from post_id) works for both cases with no special-casing.
--
-- mentioned_type is an ENUM even though only 'user' is currently
-- written. Companies have no username — their handle is a name with
-- spaces, which makes "@" parsing ambiguous — so they are out of scope
-- for now. The column means adding them later needs no migration.
--
-- Deletion: FKs cascade from posts and post_comments, so removing a
-- post or comment clears its mention rows automatically rather than
-- relying on every future delete path to remember.
-- =====================================================================

CREATE TABLE IF NOT EXISTS post_mentions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id         BIGINT UNSIGNED NOT NULL,
  comment_id      BIGINT UNSIGNED NULL,
  mentioned_type  ENUM('user','company') NOT NULL DEFAULT 'user',
  mentioned_id    BIGINT UNSIGNED NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),

  -- One mention per person per body. Makes the sync in src/Mentions.php
  -- idempotent: re-saving the same text inserts nothing new. MariaDB
  -- treats NULLs as distinct in a UNIQUE index, so this constrains
  -- comment mentions per (post, comment, person) and post-body mentions
  -- are guarded by the application reading existing rows before insert.
  UNIQUE KEY uq_mention (post_id, comment_id, mentioned_type, mentioned_id),

  -- "Who was mentioned" is the hot read (a future "mentions of me"
  -- surface, and the notification fan-out).
  KEY idx_mentions_person (mentioned_type, mentioned_id, created_at),
  KEY idx_mentions_post (post_id),
  KEY idx_mentions_comment (comment_id),

  CONSTRAINT fk_mentions_post
    FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_mentions_comment
    FOREIGN KEY (comment_id) REFERENCES post_comments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
