<?php

// =====================================================================
// FILE: api/admin/cert-catalog.php
// Admin-only management of official certification catalog entries
// (cert_catalog_entries), which merge into score relevance and the
// profile cert typeahead alongside the static generated catalog.
//
// GET  — list all entries, newest first.
// POST — add one: { name, issuer?, aliases?: string[], cats: int[] }
//        cats are JobCatalog category indices; at least one required.
//        (name, issuer) must be unique. Audited.
// Deletion: api/admin/delete-cert-catalog.php.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Audit.php';
require_once __DIR__ . '/../../src/JobCatalog.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET' && $method !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$adminId = Auth::requireAdmin();
$pdo = Database::conn();

if ($method === 'GET') {
    $rows = $pdo->query(
        'SELECT e.id, e.name, e.issuer, e.aliases, e.cats, e.created_at, u.username AS created_by
         FROM cert_catalog_entries e
         LEFT JOIN users u ON u.id = e.created_by
         ORDER BY e.id DESC'
    )->fetchAll();
    foreach ($rows as &$r) {
        $r['aliases'] = (array) json_decode($r['aliases'] ?? '[]', true);
        $r['cats']    = array_map('intval', (array) json_decode($r['cats'] ?? '[]', true));
    }
    Response::success(['entries' => $rows, 'categories' => JobCatalog::CATEGORIES]);
}

// ---- POST: add ----
$in     = Response::input();
$name   = trim($in['name'] ?? '');
$issuer = trim($in['issuer'] ?? '');
$cats   = $in['cats'] ?? [];
$alias  = $in['aliases'] ?? [];

if ($name === '')            Response::error('A certification name is required.', 422);
if (mb_strlen($name) > 190)  Response::error('Name must be 190 characters or fewer.', 422);
if (mb_strlen($issuer) > 190) Response::error('Issuer must be 190 characters or fewer.', 422);

// Categories: unique ints inside the JobCatalog range, at least one —
// they're what makes the entry meaningful to the score engine.
$maxCat = count(JobCatalog::CATEGORIES) - 1;
if (!is_array($cats)) Response::error('cats must be an array of category indices.', 422);
$catIds = [];
foreach ($cats as $c) {
    if (!is_numeric($c)) Response::error('cats must contain only category indices.', 422);
    $c = (int) $c;
    if ($c < 0 || $c > $maxCat) Response::error("Category index $c is out of range (0-$maxCat).", 422);
    $catIds[$c] = true;
}
$catIds = array_keys($catIds);
if (!$catIds) Response::error('At least one category is required.', 422);

// Aliases: optional lowercase match strings, deduplicated, each ≤190.
if (!is_array($alias)) Response::error('aliases must be an array of strings.', 422);
$aliases = [];
foreach ($alias as $a) {
    if (!is_string($a)) continue;
    $a = mb_strtolower(trim(preg_replace('/\s+/', ' ', $a)));
    if ($a === '' || mb_strlen($a) > 190) continue;
    $aliases[$a] = true;
}
$aliases = array_keys($aliases);

// Uniqueness on (name, issuer).
$dupe = $pdo->prepare('SELECT id FROM cert_catalog_entries WHERE name = ? AND issuer = ? LIMIT 1');
$dupe->execute([$name, $issuer]);
if ($dupe->fetch()) Response::error('That certification (name + issuer) is already in the catalog.', 409);

$ins = $pdo->prepare(
    'INSERT INTO cert_catalog_entries (name, issuer, aliases, cats, created_by)
     VALUES (?, ?, ?, ?, ?)'
);
$ins->execute([$name, $issuer, json_encode($aliases), json_encode($catIds), $adminId]);
$id = (int) $pdo->lastInsertId();

Audit::log($adminId, 'cert_catalog_add', 'cert_catalog', null, $name, [
    'id' => $id, 'issuer' => $issuer, 'cats' => $catIds, 'aliases' => $aliases,
]);

Response::success([
    'id' => $id, 'name' => $name, 'issuer' => $issuer,
    'aliases' => $aliases, 'cats' => $catIds,
]);
