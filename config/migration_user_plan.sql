-- =====================================================================
-- MIGRATION: user account plan/tier
-- Adds a `plan` column to `users` to distinguish free vs paid accounts.
--
-- Intentionally brand-neutral: the value is 'plus', NOT tied to the
-- current product name, so a future rename never touches this column.
--
-- Effect on the app:
--   free  -> up to 2 main score entries (distinct target_type+target_value)
--   plus  -> up to 5 main score entries
-- Re-scoring an EXISTING entry is always allowed (that only adds history);
-- the cap only limits how many DISTINCT entries a profile can hold.
--
-- Run this in phpMyAdmin. Safe to re-run (uses IF NOT EXISTS).
-- .sql files in this repo are documentation; the live DB is the source
-- of truth.
-- =====================================================================

ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `plan`
  ENUM('free','plus') NOT NULL DEFAULT 'free'
  AFTER `role`;
