<?php

// =====================================================================
// FILE: api/admin/delete-cert-catalog.php
// POST { id } — remove an admin-added certification catalog entry.
// Admin-only, audited. The static generated catalog is unaffected.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Audit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

$adminId = Auth::requireAdmin();
$pdo = Database::conn();

$in = Response::input();
$id = (int) ($in['id'] ?? 0);
if ($id <= 0) Response::error('An entry id is required.', 422);

$stmt = $pdo->prepare('SELECT name, issuer FROM cert_catalog_entries WHERE id = ? LIMIT 1');
$stmt->execute([$id]);
$entry = $stmt->fetch();
if (!$entry) Response::error('Catalog entry not found.', 404);

$pdo->prepare('DELETE FROM cert_catalog_entries WHERE id = ?')->execute([$id]);

Audit::log($adminId, 'cert_catalog_delete', 'cert_catalog', null, $entry['name'], [
    'id' => $id, 'issuer' => $entry['issuer'],
]);

Response::success(['id' => $id]);
