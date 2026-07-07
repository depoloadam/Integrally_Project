-- =====================================================================
-- migration_company_settings.sql
-- Adds a key/value settings store for companies, mirroring user_settings.
-- Run this in phpMyAdmin BEFORE copying the dependent PHP.
--
-- Used initially for notification preferences (notify_like, notify_comment,
-- notify_follow, and their email_* counterparts), but general-purpose:
-- new settings need no further migration.
-- =====================================================================

CREATE TABLE IF NOT EXISTS company_settings (
  company_id    BIGINT UNSIGNED NOT NULL,
  setting_key   VARCHAR(64)  NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  PRIMARY KEY (company_id, setting_key),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
