-- =====================================================================
-- Post actions: save, hide, "show fewer like this" (author mute), report.
-- All four are polymorphic on the ACTOR (user OR company), matching the
-- post_likes / post_comments pattern: (actor_type, actor_id).
-- Documentation only — run manually in phpMyAdmin.
-- =====================================================================

-- Saved posts (bookmark). Surfaced on the #saved page.
CREATE TABLE IF NOT EXISTS post_saves (
  actor_type ENUM('user','company') NOT NULL,
  actor_id   BIGINT UNSIGNED NOT NULL,
  post_id    BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_type, actor_id, post_id),
  KEY idx_post (post_id),
  KEY idx_actor_recent (actor_type, actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hidden posts. A hidden post is filtered out of every feed for this
-- actor, permanently, until they unhide it (no unhide UI in v1 — hides
-- are cheap and the post simply disappears).
CREATE TABLE IF NOT EXISTS post_hides (
  actor_type ENUM('user','company') NOT NULL,
  actor_id   BIGINT UNSIGNED NOT NULL,
  post_id    BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_type, actor_id, post_id),
  KEY idx_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Show fewer posts like this" — mutes an AUTHOR (user or company) for
-- the acting viewer. Every post by a muted author is filtered from the
-- viewer's feeds. Distinct from unfollow: you can keep following someone
-- and still turn their volume down, and it also covers Explore where no
-- follow relationship exists.
CREATE TABLE IF NOT EXISTS author_mutes (
  actor_type   ENUM('user','company') NOT NULL,   -- the viewer muting
  actor_id     BIGINT UNSIGNED NOT NULL,
  author_type  ENUM('user','company') NOT NULL,   -- the author muted
  author_id    BIGINT UNSIGNED NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_type, actor_id, author_type, author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reports. One report per (actor, post); re-reporting updates the reason.
-- status is for a future moderation queue (admins already have a Posts
-- tab). No admin surface for these yet — this table just captures them.
CREATE TABLE IF NOT EXISTS post_reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id     BIGINT UNSIGNED NOT NULL,
  actor_type  ENUM('user','company') NOT NULL,
  actor_id    BIGINT UNSIGNED NOT NULL,
  reason      VARCHAR(40) NOT NULL,              -- machine key, see Reports::REASONS
  detail      VARCHAR(500) NULL,
  status      ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_actor_post (post_id, actor_type, actor_id),
  KEY idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
