-- =====================================================================
-- Migration: user phone number + job pay period (annual/hourly)
-- Run manually in phpMyAdmin. (.sql files here are documentation only —
-- the live schema is managed directly in phpMyAdmin.)
-- =====================================================================

-- ---- 1) Phone number on user profiles -------------------------------
-- Always private: never returned by public profile endpoints. Surfaced
-- only to the owner, and to companies the user has applied to (via the
-- application detail "See contact information" action). `phone_verified`
-- is reserved for the future verification flow; unused for now but added
-- here so we don't need a second migration later.
ALTER TABLE users
  ADD COLUMN phone VARCHAR(32) NULL DEFAULT NULL AFTER country,
  ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER phone;

-- ---- 2) Pay period on jobs ------------------------------------------
-- Existing salary_min / salary_max / salary_currency stay as-is; this
-- just records whether those figures are annual or hourly. Existing rows
-- default to 'annual', which matches how they were entered.
ALTER TABLE jobs
  ADD COLUMN pay_period ENUM('annual','hourly') NOT NULL DEFAULT 'annual' AFTER salary_currency;
