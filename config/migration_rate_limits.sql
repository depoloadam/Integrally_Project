-- =====================================================================
-- FILE: config/migration_rate_limits.sql
-- ---------------------------------------------------------------------
-- Fixed-window rate limiting counters.
--
-- One row per (bucket_key, window_start). bucket_key encodes both the
-- actor and the action, e.g.:
--     user:12|score_me
--     company:3|write
--     ip:9f86d081...|auth_login_fail
--     login:adam@example.com|auth_login_fail
--
-- window_start is the floor of NOW() to the bucket's window size, so a
-- 60-second window produces a new row each minute and the old ones are
-- simply garbage collected.
--
-- NO FOREIGN KEYS — deliberately. Rows are keyed by an opaque string,
-- not by user id, because anonymous (IP-keyed) traffic has no user to
-- reference and we never want a user deletion to cascade into wiping
-- an attacker's counters.
--
-- Run this in phpMyAdmin against the `integrally` database.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `rate_limits` (
  `bucket_key`   VARCHAR(191)     NOT NULL,
  `window_start` DATETIME         NOT NULL,
  `hits`         INT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (`bucket_key`, `window_start`),
  KEY `idx_window_start` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
