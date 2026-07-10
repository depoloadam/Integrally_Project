-- =====================================================================
-- MIGRATION: admin audit log
-- Records every mutating admin action (role/plan changes, account
-- activation toggles, moderation deletes) for review from the Admin
-- screen's Audit tab.
--
-- Design notes:
--   * NO foreign keys and NO cascades: an audit trail must survive the
--     deletion of the admin account or the target it references.
--   * admin_username and target_label are point-in-time SNAPSHOTS so
--     rows stay readable after renames/deletions.
--   * detail holds small JSON like {"from":"user","to":"admin"}.
--
-- Run this in phpMyAdmin. Safe to re-run (uses IF NOT EXISTS).
-- .sql files in this repo are documentation; the live DB is the truth.
-- =====================================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id       BIGINT UNSIGNED NOT NULL,      -- users.id at time of action
  admin_username VARCHAR(50)  NOT NULL,          -- snapshot
  action         VARCHAR(50)  NOT NULL,          -- 'set_role','set_plan','set_user_active','set_company_active','delete_post','delete_job'
  target_type    VARCHAR(20)  NOT NULL,          -- 'user','company','post','job'
  target_uuid    CHAR(36)     NULL,              -- when the target has one
  target_label   VARCHAR(200) NOT NULL,          -- snapshot: @username, company/job name, post snippet
  detail         JSON         NULL,              -- e.g. {"from":"free","to":"plus"}
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at),
  INDEX idx_admin   (admin_id),
  INDEX idx_action  (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
