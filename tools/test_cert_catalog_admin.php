<?php
// test_cert_catalog_admin.php — admin-added catalog entries → scoring.
//
// Live-DB integration: creates cert_catalog_entries, inserts entries the
// same way api/admin/cert-catalog.php does, and verifies:
//   - loadCustom picks them up (exact, alias, and substring matching)
//   - ScoreEngine::compute grants full relevance to a made-up cert that
//     no static catalog could know
//   - custom entries can OVERRIDE a static mapping (key collision)
//   - graceful no-table behavior (static-only, no crash)
//
// Run (DB up, socket at /run/mysqld/mysqld.sock):
//   php tools/test_cert_catalog_admin.php

require_once __DIR__ . '/../src/ScoreEngine.php';

$pdo = new PDO('mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=integrally;charset=utf8mb4', 'root', '',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);

$pass = 0; $fail = 0;
function ok(bool $c, string $n): void { global $pass,$fail; if($c){$pass++;echo "  ✓ $n\n";}else{$fail++;echo "  ✗ $n\n";} }

function profileWithCert(string $name, string $issuer = ''): array {
    return ['jobs'=>[], 'skills'=>[], 'education'=>[], 'interests'=>[],
        'certifications'=>[['name'=>$name,'issuer'=>$issuer]],
        'profile'=>['bio'=>'','city'=>'','profile_pic'=>null]];
}
function certPts(string $cert, string $target, string $issuer = ''): float {
    $r = ScoreEngine::compute(profileWithCert($cert, $issuer), 'job_title', $target);
    foreach ($r['breakdown'] as $f) if ($f['factor'] === 'certifications') return $f['points'];
    return -1;
}

echo "no-table grace\n";
$pdo->exec('DROP TABLE IF EXISTS cert_catalog_entries');
CertCatalog::resetCustom();
CertCatalog::loadCustom($pdo);   // table absent — must not throw
ok(true, "loadCustom with no table does not throw");
ok(certPts('CCNA', 'network administrator', 'Cisco') >= 4.0, "static catalog still fully works without the table");

echo "\nmigration + insert (endpoint-shaped rows)\n";
$sql = file_get_contents(__DIR__ . '/../config/migration_cert_catalog_entries.sql');
$pdo->exec($sql);
ok(true, "migration ran clean");
$ins = $pdo->prepare('INSERT INTO cert_catalog_entries (name, issuer, aliases, cats, created_by) VALUES (?,?,?,?,1)');
// A cert no static catalog could know: maps to Skilled Trades (18).
$ins->execute(['Integrally Master Fabricator', 'Integrally Trade Guild', json_encode(['imf','master fabricator']), json_encode([18])]);
// An override: remap static "quickbooks" (Finance 9) to Operations (11) to prove custom wins collisions.
$ins->execute(['QuickBooks Override Test', '', json_encode(['quickbooks']), json_encode([11])]);

echo "\nresolution through the engine\n";
CertCatalog::resetCustom();
CertCatalog::loadCustom($pdo);
ok(certPts('Integrally Master Fabricator', 'welder', 'Integrally Trade Guild') >= 4.0,
   "made-up admin cert → Welder: full relevance (exact match)");
ok(certPts('IMF', 'welder') >= 4.0, "alias 'imf' resolves (alias match)");
ok(certPts('Advanced Integrally Master Fabricator Level II', 'welder') >= 4.0,
   "longer text containing the entry resolves (substring match)");
// "Master" is a real job-title token (Scrum Master, Master Electrician),
// so the fuzzy layer grants a small fractional credit by design — the
// bound here is "no meaningful boost", not the exact 1.0 floor.
ok(certPts('Integrally Master Fabricator', 'software engineer') <= 2.0,
   "same cert vs unrelated target gets no meaningful boost (fuzz noise only)");

echo "\ncustom overrides static on key collision\n";
CertCatalog::resetCustom();
CertCatalog::loadCustom($pdo);
$cats = CertCatalog::categoriesForCert('quickbooks', '');
ok($cats === [11], "alias 'quickbooks' now resolves to the admin mapping [11], not static [9] (got [" . implode(',', $cats ?? []) . "])");

echo "\ngatherProfile wiring\n";
// gatherProfile must call loadCustom itself (fresh cache, real user not
// required for the load — the call happens before any user queries).
CertCatalog::resetCustom();
try { ScoreEngine::gatherProfile($pdo, 999999); } catch (Throwable $e) { /* user queries may fail; load already ran */ }
$cats2 = CertCatalog::categoriesForCert('integrally master fabricator', '');
ok($cats2 === [18], "gatherProfile triggers loadCustom (custom entry resolves after it)");

echo "\ncleanup + delete flow\n";
$pdo->exec('DELETE FROM cert_catalog_entries WHERE name = "QuickBooks Override Test"');
CertCatalog::resetCustom(); CertCatalog::loadCustom($pdo);
$cats3 = CertCatalog::categoriesForCert('quickbooks', '');
ok($cats3 === [9], "after deletion the static mapping [9] is back (got [" . implode(',', $cats3 ?? []) . "])");

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
