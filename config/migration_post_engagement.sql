-- =====================================================================
-- FILE: config/migration_post_engagement.sql
-- ---------------------------------------------------------------------
-- Backfills three tables that the application has always depended on
-- but which were never captured in any repo SQL file: they existed only
-- in the live database. A fresh clone 500s on the feed without them.
--
--   post_likes     — queried by api/posts/like.php, api/posts/saved.php,
--                    api/admin/posts.php, api/admin/stats.php,
--                    src/Social.php::engagement(), src/PostActions.php
--   post_comments  — queried by api/posts/comment-{add,list,delete}.php
--                    and the same aggregate/ordering paths as above
--   notifications  — written by src/Social.php::notify(), read by
--                    api/notifications/{list,mark-read}.php, and cleaned
--                    up on unlike in api/posts/like.php
--
-- Actor pattern matches the rest of the codebase: (actor_type, actor_id)
-- where actor_type is 'user' or 'company', so posts can be liked and
-- commented on by either identity. No FK on actor_id for that reason —
-- it points at two different tables depending on actor_type.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- =====================================================================

-- ---- post_likes ------------------------------------------------------
-- One row per (post, actor). The unique key is what makes the
-- INSERT IGNORE in api/posts/like.php idempotent, and what lets the
-- endpoint distinguish a new like (rowCount > 0) from a repeat — the
-- notification is only sent on a genuinely new like.
CREATE TABLE IF NOT EXISTS post_likes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id     BIGINT UNSIGNED NOT NULL,
  actor_type  ENUM('user','company') NOT NULL,
  actor_id    BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_like (post_id, actor_type, actor_id),
  KEY idx_post_likes_post (post_id),
  KEY idx_post_likes_actor (actor_type, actor_id),
  CONSTRAINT fk_post_likes_post
    FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- post_comments ---------------------------------------------------
-- No unique key: the same actor may comment repeatedly on a post.
-- Ordered by created_at ASC on read (api/posts/comment-list.php).
CREATE TABLE IF NOT EXISTS post_comments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id     BIGINT UNSIGNED NOT NULL,
  actor_type  ENUM('user','company') NOT NULL,
  actor_id    BIGINT UNSIGNED NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post_comments_post (post_id, created_at),
  KEY idx_post_comments_actor (actor_type, actor_id),
  CONSTRAINT fk_post_comments_post
    FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- notifications ---------------------------------------------------
-- Recipient is an actor (user or company); so is the actor who caused
-- the notification. post_id / comment_id are nullable because not every
-- notification type references them (e.g. follows).
--
-- The (recipient, is_read) index backs the unread-count query that the
-- nav badge polls, which is the hottest read on this table.
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_type  ENUM('user','company') NOT NULL,
  recipient_id    BIGINT UNSIGNED NOT NULL,
  actor_type      ENUM('user','company') NOT NULL,
  actor_id        BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(32) NOT NULL,
  post_id         BIGINT UNSIGNED NULL,
  comment_id      BIGINT UNSIGNED NULL,
  is_read         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_recipient (recipient_type, recipient_id, is_read),
  KEY idx_notif_recipient_created (recipient_type, recipient_id, created_at),
  KEY idx_notif_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
