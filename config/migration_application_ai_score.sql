-- =====================================================================
-- migration_application_ai_score.sql
-- Stores an AI-inclusive score snapshot on each application, captured at
-- apply time alongside the Standard score_value. Only populated when the
-- applicant had their AI Skillset enabled at apply time; NULL otherwise
-- (so the company's AI view shows no score for AI-off applicants rather
-- than a Standard-equivalent fallback). Nullable so pre-migration rows
-- and scoreless applications remain valid.
-- =====================================================================

ALTER TABLE `job_applications`
  ADD COLUMN `ai_score` float DEFAULT NULL AFTER `score_algo`,
  ADD COLUMN `ai_breakdown` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
      DEFAULT NULL CHECK (json_valid(`ai_breakdown`)) AFTER `ai_score`;
