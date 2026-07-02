-- =====================================================================
-- MIGRATION: company Following feed
-- Makes the FOLLOWER side of `follows` polymorphic (user OR company),
-- mirroring the target side. Existing rows are all user follows, so
-- the new column defaults to 'user' and nothing is lost.
--
-- RUN THIS BEFORE copying the new PHP files — the updated follow
-- endpoints and post fan-out reference `follower_type` and will 500
-- until this column exists.
--
-- Step 1 drops the old FK (follower_id -> users.id), which can't stay
-- now that a follower_id may point at `companies`. If MySQL says the
-- constraint name doesn't exist, run  SHOW CREATE TABLE follows;  and
-- use the FK name it prints there instead of `follows_ibfk_1`.
-- =====================================================================

ALTER TABLE `follows` DROP FOREIGN KEY `follows_ibfk_1`;

ALTER TABLE `follows`
  ADD COLUMN `follower_type` ENUM('user','company') NOT NULL DEFAULT 'user' AFTER `id`;

ALTER TABLE `follows`
  DROP INDEX `uniq_follow`,
  ADD UNIQUE KEY `uniq_follow` (`follower_type`, `follower_id`, `target_type`, `target_id`),
  ADD KEY `idx_follower` (`follower_type`, `follower_id`);
