-- =====================================================================
-- FILE: config/migration_job_applications_channel.sql
-- Adds an application CHANNEL to job_applications.
--
-- Run this ONCE in phpMyAdmin (after migration_job_applications.sql).
--
-- Why:
--   Candidates can now record that they applied OFF-PLATFORM (clicked the
--   company's external apply link) as a personal tracking entry, in
--   addition to — or instead of — a native Integrally "Quick apply".
--
--     apply_channel = 'native'    submitted through Integrally (has the
--                                 answers / resume / score snapshot; shows
--                                 up in the company's ranked applicant list)
--     apply_channel = 'external'  candidate marked "I applied on the company
--                                 site". No snapshots. NEVER shown to the
--                                 company (they handle those applicants via
--                                 their own site). Candidate-only tracking.
--
--   A user may hold at most ONE native AND one external record per job, so
--   the uniqueness key moves from (job_id, user_id) to
--   (job_id, user_id, apply_channel).
-- =====================================================================

-- 1) New column (guarded so re-running is harmless). If your MySQL/MariaDB
--    version does not support "ADD COLUMN IF NOT EXISTS", run the bare
--    statement once and remove the clause.
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS apply_channel ENUM('native','external')
      NOT NULL DEFAULT 'native' AFTER user_id;

-- 2) Swap the uniqueness constraint from (job, user) to
--    (job, user, channel). Existing rows are all native, so this is safe.
--    NOTE: DROP INDEX is not guardable with IF EXISTS on older MySQL. If
--    the key was already renamed/dropped by a previous run, this line will
--    error harmlessly — just continue past it.
ALTER TABLE job_applications DROP INDEX uq_job_user;

ALTER TABLE job_applications
  ADD UNIQUE KEY uq_job_user_channel (job_id, user_id, apply_channel);
