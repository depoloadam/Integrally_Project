<?php

// =====================================================================
// FILE: api/certs/custom.php
// GET (logged in) — admin-added certification catalog entries, for
// merging into the profile cert-name typeahead alongside the static
// catalog (assets/js/certs-catalog.js). Returns [] until the
// cert_catalog_entries migration has been run.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

Auth::requireLogin();
$pdo = Database::conn();

try {
    $rows = $pdo->query(
        'SELECT name, issuer, aliases, cats FROM cert_catalog_entries ORDER BY name ASC'
    )->fetchAll();
} catch (Throwable $e) {
    Response::success(['entries' => []]);   // table not migrated yet
}

foreach ($rows as &$r) {
    $r['aliases'] = (array) json_decode($r['aliases'] ?? '[]', true);
    $r['cats']    = array_map('intval', (array) json_decode($r['cats'] ?? '[]', true));
}

Response::success(['entries' => $rows]);
