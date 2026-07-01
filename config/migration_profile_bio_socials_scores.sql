-- =====================================================================
-- Migration: bio/social profile attributes, per-score hiding
-- Run this manually in phpMyAdmin against the `integrally` database.
-- Safe to run once; re-running attribute_definitions inserts will fail
-- on duplicate primary key (attr_key), which is expected/harmless.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New table: per-target score hiding
--    A user can hide a specific (target_type, target_value) score from
--    showing on their public profile. Scores are recalculated over time
--    (new rows in `scores`), so we key hides off the target itself
--    rather than a specific scores.id.
-- ---------------------------------------------------------------------
CREATE TABLE `hidden_scores` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `target_type` enum('job_title','skill','field') NOT NULL,
  `target_value` varchar(150) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `hidden_scores`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_user_target` (`user_id`,`target_type`,`target_value`),
  ADD KEY `user_id` (`user_id`);

ALTER TABLE `hidden_scores`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `hidden_scores`
  ADD CONSTRAINT `hidden_scores_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 2. Attribute definitions: bio + social links
--    These are stored as rows in user_profile_attributes (already used
--    for `headline`), so no new columns on `users` are needed. This just
--    registers them with proper labels/types and marks them public.
-- ---------------------------------------------------------------------
INSERT INTO `attribute_definitions` (`attr_key`, `label`, `input_type`, `options`, `is_public`, `sort_order`) VALUES
('bio',          'Bio',              'textarea', NULL, 1, 10),
('linkedin_url',  'LinkedIn URL',    'text',     NULL, 1, 20),
('twitter_url',   'Twitter / X URL', 'text',     NULL, 1, 21),
('website_url',   'Personal website','text',     NULL, 1, 22);

COMMIT;
