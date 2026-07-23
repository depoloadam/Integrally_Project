-- =====================================================================
-- Admin-managed certification catalog entries.
--
-- The static cert catalog (assets/js/certs-catalog.js → generated
-- src/CertCatalog.php) covers well-known certifications; this table
-- lets admins add official catalog items at runtime without a deploy.
-- Entries are merged into scoring (CertCatalog::loadCustom, called from
-- ScoreEngine::gatherProfile) and into the profile cert typeahead
-- (api/certs/custom.php). Admin CRUD: api/admin/cert-catalog.php +
-- api/admin/delete-cert-catalog.php, surfaced in the admin "Certs" tab.
--
--   name    canonical display name the typeahead inserts
--   issuer  optional issuing organization
--   aliases JSON array of lowercase match strings (acronyms, families)
--   cats    JSON array of JobCatalog category indices (0..26)
--
-- Documentation only — run manually in phpMyAdmin.
-- =====================================================================

CREATE TABLE IF NOT EXISTS cert_catalog_entries (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(190) NOT NULL,
  issuer     VARCHAR(190) NOT NULL DEFAULT '',
  aliases    TEXT NOT NULL,
  cats       VARCHAR(190) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name_issuer (name, issuer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
