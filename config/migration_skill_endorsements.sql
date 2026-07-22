-- =====================================================================
-- MIGRATION: skill endorsements ("vouching")
-- ---------------------------------------------------------------------
-- A connection (mutual follow) can vouch for a specific skill on another
-- user's profile. One row per (target, skill, endorser). Endorsements
-- are a social/trust signal shown on the skill; a future ScoreEngine
-- version (v2.3, reviewed separately) may fold a capped, decaying form
-- of the count into the skills factor. Nothing in the CURRENT scoring
-- engine reads this table.
--
-- RUN THIS BEFORE copying the new PHP files — the endorsement endpoints
-- and the updated skills/list.php reference `skill_endorsements` and
-- will 500 until this table exists.
--
-- Anti-abuse gating (endorser must be a mutual follow, may not endorse
-- own skills, skill must be on the target's profile) is enforced in PHP
-- at write time, not by constraints here; the UNIQUE key only prevents
-- duplicate endorsements of the same skill by the same endorser.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `skill_endorsements` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_user_id`   BIGINT UNSIGNED NOT NULL,
  `skill_id`         BIGINT UNSIGNED NOT NULL,
  `endorser_user_id` BIGINT UNSIGNED NOT NULL,
  `created_at`       TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_endorsement` (`target_user_id`, `skill_id`, `endorser_user_id`),
  KEY `idx_target_skill` (`target_user_id`, `skill_id`),
  KEY `idx_endorser` (`endorser_user_id`),
  CONSTRAINT `se_target_fk`   FOREIGN KEY (`target_user_id`)   REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `se_skill_fk`    FOREIGN KEY (`skill_id`)         REFERENCES `skills` (`id`) ON DELETE CASCADE,
  CONSTRAINT `se_endorser_fk` FOREIGN KEY (`endorser_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
