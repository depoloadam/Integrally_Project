-- =====================================================================
-- migration_ai_score.sql
-- Adds the AI-inclusive score alongside the Standard score on each
-- scores row. Both are computed from the same profile snapshot at
-- score time (see ScoreEngine::compute / computeAiInclusive), so a row
-- carries the Standard score (score_value/breakdown) AND the
-- AI-inclusive score (ai_score/ai_breakdown). Nullable so pre-migration
-- rows and any single-algorithm write paths remain valid.
-- =====================================================================

ALTER TABLE `scores`
  ADD COLUMN `ai_score` float DEFAULT NULL AFTER `breakdown`,
  ADD COLUMN `ai_breakdown` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
      DEFAULT NULL CHECK (json_valid(`ai_breakdown`)) AFTER `ai_score`;
