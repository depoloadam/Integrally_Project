-- =====================================================================
-- Migration: adds `website_label` attribute definition.
--
-- NOTE: If you already ran this against your live database in a
-- previous session, running it again is harmless — the INSERT will
-- simply fail on the duplicate primary key (attr_key), which you can
-- ignore. Only skip this file if you're certain `website_label` is
-- already a row in `attribute_definitions`.
-- =====================================================================

INSERT INTO `attribute_definitions` (`attr_key`, `label`, `input_type`, `options`, `is_public`, `sort_order`) VALUES
('website_label', 'Website display name', 'text', NULL, 1, 23);

COMMIT;
