-- =====================================================================
-- CareerScore — Database Schema
-- MySQL 8.0+ / MariaDB 10.5+  ·  InnoDB  ·  utf8mb4
-- Run order matters: tables are created before anything that references
-- them via foreign keys.
-- =====================================================================

-- Create and select the database.
CREATE DATABASE IF NOT EXISTS careerscore
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE careerscore;

-- For a clean re-run during development, drop in reverse-dependency order.
-- (Comment these out once you have real data you want to keep.)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS feed_items;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS user_interests;
DROP TABLE IF EXISTS interests;
DROP TABLE IF EXISTS user_skills;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS certifications;
DROP TABLE IF EXISTS education;
DROP TABLE IF EXISTS job_history;
DROP TABLE IF EXISTS attribute_definitions;
DROP TABLE IF EXISTS user_profile_attributes;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;


-- =====================================================================
-- 1. CORE ACCOUNTS
-- =====================================================================

-- ---------------------------------------------------------------------
-- users : core, stable account fields only.
-- Evolving/descriptive fields live in user_profile_attributes.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid            CHAR(36)     NOT NULL UNIQUE,      -- public-facing ID
  email           VARCHAR(255) NOT NULL UNIQUE,      -- one account per email
  username        VARCHAR(50)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NULL,                 -- NULL for OAuth-only users
  auth_provider   VARCHAR(20)  NOT NULL DEFAULT 'local', -- 'local','google','apple'...
  provider_id     VARCHAR(255) NULL,                 -- provider's stable user ID
  city            VARCHAR(100),
  state           VARCHAR(100),
  country         VARCHAR(100),
  profile_pic     VARCHAR(255),                      -- local path or S3 URL
  is_verified     TINYINT(1)   NOT NULL DEFAULT 0,   -- email verification flag
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_location (country, state, city),
  INDEX idx_provider (auth_provider, provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- companies : organizations sign up as their own entity and can be
-- followed by users.
-- ---------------------------------------------------------------------
CREATE TABLE companies (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid            CHAR(36)     NOT NULL UNIQUE,
  email           VARCHAR(255) NOT NULL UNIQUE,
  name            VARCHAR(150) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  industry        VARCHAR(100),
  city            VARCHAR(100),
  state           VARCHAR(100),
  country         VARCHAR(100),
  logo            VARCHAR(255),
  website         VARCHAR(255),
  description     TEXT,
  is_verified     TINYINT(1)   NOT NULL DEFAULT 0,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 2. FLEXIBLE PROFILE ATTRIBUTES
--    Add new descriptive profile fields with NO schema migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- user_profile_attributes : key-value store for evolving, display-only
-- profile fields (headline, bio, career_goal, etc.).
-- ---------------------------------------------------------------------
CREATE TABLE user_profile_attributes (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  attr_key    VARCHAR(64)  NOT NULL,        -- e.g. 'headline', 'bio'
  attr_value  TEXT,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_attr (user_id, attr_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_attr_key (attr_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- attribute_definitions : describes each attr_key so the frontend can
-- render new fields dynamically. Add a field = insert a row here.
-- ---------------------------------------------------------------------
CREATE TABLE attribute_definitions (
  attr_key    VARCHAR(64) PRIMARY KEY,
  label       VARCHAR(120) NOT NULL,
  input_type  ENUM('text','textarea','number','date','select','bool')
                NOT NULL,
  options     JSON,                         -- choices for 'select' types
  is_public   TINYINT(1)  NOT NULL DEFAULT 1,
  sort_order  INT         NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 3. STRUCTURED REPEATING PROFILE DATA
--    Normalized child tables (each user has many).
-- =====================================================================

-- ---------------------------------------------------------------------
-- job_history
-- ---------------------------------------------------------------------
CREATE TABLE job_history (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(150) NOT NULL,
  company_name  VARCHAR(150),
  company_id    BIGINT UNSIGNED NULL,       -- set if a registered company
  start_date    DATE,
  end_date      DATE,                        -- NULL = current role
  description   TEXT,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  INDEX idx_user (user_id),
  INDEX idx_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- education
-- ---------------------------------------------------------------------
CREATE TABLE education (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  institution  VARCHAR(150),
  degree       VARCHAR(150),
  field        VARCHAR(150),
  start_year   SMALLINT,
  end_year     SMALLINT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- certifications
-- ---------------------------------------------------------------------
CREATE TABLE certifications (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(150) NOT NULL,
  issuer        VARCHAR(150),
  issue_date    DATE,
  expiry_date   DATE,
  credential_id VARCHAR(100),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- skills : master list, de-duplicated by unique name.
-- user_skills : join table linking users to skills.
-- ---------------------------------------------------------------------
CREATE TABLE skills (
  id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_skills (
  user_id      BIGINT UNSIGNED NOT NULL,
  skill_id     BIGINT UNSIGNED NOT NULL,
  proficiency  TINYINT,                     -- optional 1-5 self-rating
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- interests : master list.
-- user_interests : join table. Powers feed + scoring.
-- ---------------------------------------------------------------------
CREATE TABLE interests (
  id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_interests (
  user_id     BIGINT UNSIGNED NOT NULL,
  interest_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, interest_id),
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (interest_id) REFERENCES interests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 4. SOCIAL GRAPH
-- =====================================================================

-- ---------------------------------------------------------------------
-- follows : polymorphic. follower is always a user; target is a user
-- OR a company, differentiated by target_type. Target integrity is
-- enforced in application logic (no single FK possible on target_id).
-- ---------------------------------------------------------------------
CREATE TABLE follows (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  follower_id   BIGINT UNSIGNED NOT NULL,            -- always a user
  target_type   ENUM('user','company') NOT NULL,    -- discriminator
  target_id     BIGINT UNSIGNED NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_follow (follower_id, target_type, target_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 5. FEEDS
-- =====================================================================

-- ---------------------------------------------------------------------
-- posts : content authored by a user or company (polymorphic author).
-- Powers the personal feed page.
-- ---------------------------------------------------------------------
CREATE TABLE posts (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  author_type  ENUM('user','company') NOT NULL,
  author_id    BIGINT UNSIGNED NOT NULL,
  post_type    VARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text','cert','job',...
  body         TEXT,                                  -- optional for structured types
  media_url    VARCHAR(255),
  meta         JSON,                                  -- structured data per post_type
  visibility   ENUM('public','followers') NOT NULL DEFAULT 'public',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_author (author_type, author_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- feed_items : the main feed. Records which posts can appear in whose
-- feed and why. The ranking algorithm (TBD) fills `score`; any future
-- algorithm can rank these rows.
-- ---------------------------------------------------------------------
CREATE TABLE feed_items (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,    -- whose feed this is for
  post_id      BIGINT UNSIGNED NOT NULL,
  reason       VARCHAR(64),                 -- 'followed','interest_match'...
  score        FLOAT DEFAULT 0,             -- ranking weight
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_feed (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  INDEX idx_user_score (user_id, score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 6. SCORE ME!
--    Calculated only on user request, then stored.
-- =====================================================================

CREATE TABLE scores (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  target_type   ENUM('job_title','skill','field') NOT NULL,
  target_value  VARCHAR(150) NOT NULL,      -- what they scored against
  score_value   FLOAT NOT NULL,             -- computed result
  breakdown     JSON,                       -- per-factor detail for display
  algo_version  VARCHAR(20),                -- keeps old scores interpretable
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_target (user_id, target_type, target_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- 7. SETTINGS & VERIFICATION
-- =====================================================================

-- ---------------------------------------------------------------------
-- user_settings : key-value toggles (e.g. 'following_enabled').
-- New settings need no migration.
-- ---------------------------------------------------------------------
CREATE TABLE user_settings (
  user_id       BIGINT UNSIGNED NOT NULL,
  setting_key   VARCHAR(64)  NOT NULL,      -- e.g. 'following_enabled'
  setting_value VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, setting_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------
-- email_verifications : ready for when you enable email activation.
-- ---------------------------------------------------------------------
CREATE TABLE email_verifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token       CHAR(64)  NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- End of schema. Build endpoints in this rough order:
--   auth (register/login) -> profile -> follows -> posts -> feed -> scores
-- =====================================================================