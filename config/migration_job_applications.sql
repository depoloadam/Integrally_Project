-- =====================================================================
-- FILE: config/migration_job_applications.sql
-- Native job applications (v1).
--
-- Run this ONCE in phpMyAdmin before deploying the applications drop.
--
-- Design notes:
--   * jobs gains three columns:
--       apply_method  native | external | both   (how candidates apply)
--       apply_form    JSON    company's custom application form spec
--       accept_until  DATE    optional per-job application cutoff
--   * A candidate submits at most ONE application per job (unique key).
--   * Only two statuses are ever STORED: 'submitted' and 'withdrawn'.
--     'expired' and 'job_unavailable' are DERIVED at read time from
--     accept_until (or a 90-day default window) and the parent job's
--     status/existence — never written to this table.
--   * answers / resume / score are SNAPSHOTTED at apply time so the
--     company always sees exactly what was sent, even if the candidate
--     later edits their profile or resume.
-- =====================================================================

-- ---- jobs: application settings --------------------------------------
-- Guarded so re-running is harmless. If your MySQL/MariaDB version does
-- not support "ADD COLUMN IF NOT EXISTS", run these three lines once and
-- remove the IF NOT EXISTS clauses.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS apply_method ENUM('native','external','both')
      NOT NULL DEFAULT 'native' AFTER apply_url,
  ADD COLUMN IF NOT EXISTS apply_form JSON NULL AFTER apply_method,
  ADD COLUMN IF NOT EXISTS accept_until DATE NULL AFTER apply_form;

-- ---- applications ----------------------------------------------------
CREATE TABLE IF NOT EXISTS job_applications (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36) NOT NULL,
  job_id           INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NOT NULL,

  -- Snapshot of the candidate's answers to the job's apply_form
  -- questions: { "<question_key>": "<answer text>", ... }.
  answers          JSON NULL,

  -- Frozen resume copy (a physical duplicate in private/resumes/), so
  -- the company's view never changes if the profile resume changes.
  -- NULL when the form did not request / the candidate did not attach one.
  resume_file      VARCHAR(80) NULL,
  resume_name      VARCHAR(160) NULL,

  -- Score snapshot vs the job title at apply time (the differentiator).
  -- NULL when the candidate had no scoreable profile / snapshot disabled.
  score_value      DECIMAL(5,2) NULL,
  score_breakdown  JSON NULL,
  score_algo       VARCHAR(40) NULL,

  status           ENUM('submitted','withdrawn') NOT NULL DEFAULT 'submitted',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at     DATETIME NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_job_user (job_id, user_id),
  UNIQUE KEY uq_uuid (uuid),
  KEY idx_job (job_id, status),
  KEY idx_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
