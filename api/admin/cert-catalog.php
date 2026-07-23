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
    require_once __DIR__ . '/../../src/CertCatalog.php';

    // Admin-added rows first — they're what can be edited directly, and
    // they're also what shadows a built-in when the names match.
    try {
        $rows = $pdo->query(
            'SELECT e.id, e.name, e.issuer, e.aliases, e.cats, e.created_at, u.username AS created_by
             FROM cert_catalog_entries e
             LEFT JOIN users u ON u.id = e.created_by
             ORDER BY e.id DESC'
        )->fetchAll();
    } catch (Throwable $e) {
        $rows = [];   // table not migrated yet — built-ins still list fine
    }

    $custom = [];
    $shadowed = [];   // normalized names that override a built-in
    foreach ($rows as $r) {
        $aliases = (array) json_decode($r['aliases'] ?? '[]', true);
        $cats    = array_map('intval', (array) json_decode($r['cats'] ?? '[]', true));
        $norm    = mb_strtolower(trim($r['name']));
        $shadowed[$norm] = true;
        $custom[] = [
            'id'         => (int) $r['id'],
            'source'     => 'custom',
            'name'       => $r['name'],
            'issuer'     => $r['issuer'],
            'aliases'    => $aliases,
            'cats'       => $cats,
            'group'      => '',
            'created_by' => $r['created_by'],
            'created_at' => $r['created_at'],
            'editable'   => true,
        ];
    }

    // Built-in roster. Anything an admin has shadowed is flagged so the
    // UI can show it as overridden rather than as the live mapping.
    $builtin = [];
    foreach (CertCatalog::staticRoster() as $s) {
        $builtin[] = [
            'id'         => null,
            'source'     => 'builtin',
            'name'       => $s['name'],
            'issuer'     => $s['issuer'],
            'aliases'    => $s['aliases'],
            'cats'       => $s['cats'],
            'group'      => $s['group'],
            'created_by' => null,
            'created_at' => null,
            'editable'   => false,
            'overridden' => isset($shadowed[mb_strtolower(trim($s['name']))]),
        ];
    }

    Response::success([
        'entries'    => array_merge($custom, $builtin),
        'categories' => JobCatalog::CATEGORIES,
        'counts'     => ['custom' => count($custom), 'builtin' => count($builtin)],
    ]);
}

// ---- POST: add (no id) or update (id) ----
$in     = Response::input();
$editId = (int) ($in['id'] ?? 0);
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

// Uniqueness on (name, issuer) — excluding the row being edited.
$dupe = $pdo->prepare('SELECT id FROM cert_catalog_entries WHERE name = ? AND issuer = ? AND id <> ? LIMIT 1');
$dupe->execute([$name, $issuer, $editId]);
if ($dupe->fetch()) Response::error('That certification (name + issuer) is already in the catalog.', 409);

if ($editId > 0) {
    // ---- update an existing admin entry ----
    $cur = $pdo->prepare('SELECT name, issuer, aliases, cats FROM cert_catalog_entries WHERE id = ? LIMIT 1');
    $cur->execute([$editId]);
    $before = $cur->fetch();
    if (!$before) Response::error('Catalog entry not found.', 404);

    $upd = $pdo->prepare(
        'UPDATE cert_catalog_entries SET name = ?, issuer = ?, aliases = ?, cats = ? WHERE id = ?'
    );
    $upd->execute([$name, $issuer, json_encode($aliases), json_encode($catIds), $editId]);

    Audit::log($adminId, 'cert_catalog_edit', 'cert_catalog', null, $name, [
        'id'     => $editId,
        'before' => [
            'name'    => $before['name'],
            'issuer'  => $before['issuer'],
            'cats'    => array_map('intval', (array) json_decode($before['cats'] ?? '[]', true)),
            'aliases' => (array) json_decode($before['aliases'] ?? '[]', true),
        ],
        'after'  => ['name' => $name, 'issuer' => $issuer, 'cats' => $catIds, 'aliases' => $aliases],
    ]);

    Response::success([
        'id' => $editId, 'name' => $name, 'issuer' => $issuer,
        'aliases' => $aliases, 'cats' => $catIds, 'updated' => true,
    ]);
}

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
