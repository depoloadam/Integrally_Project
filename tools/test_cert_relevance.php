<?php
// test_cert_relevance.php — cert-catalog-v2.3 behavioral matrix.
//
// Verifies that certifications boost scores in proportion to their
// relevance to the score target: catalog-known relevant certs earn the
// full 4 points, adjacent-field certs partial, unrelated certs the
// 1-point floor — including the famous acronym/vendor certs ("CCNA",
// "PMP", "ServSafe") that the old fuzzy-only matching scored as noise.
//
// Run: php tools/test_cert_relevance.php

require_once __DIR__ . '/../src/ScoreEngine.php';

$pass = 0; $fail = 0;
function ok(bool $c, string $name): void {
    global $pass, $fail;
    if ($c) { $pass++; echo "  ✓ $name\n"; }
    else    { $fail++; echo "  ✗ $name\n"; }
}

// Minimal profile: no experience/skills/education so the cert factor is
// isolated (other factors contribute identically across variants).
function profileWithCert(?string $name, string $issuer = ''): array {
    return [
        'jobs' => [], 'skills' => [], 'education' => [], 'interests' => [],
        'certifications' => $name === null ? [] : [['name' => $name, 'issuer' => $issuer]],
        'profile' => ['bio' => '', 'city' => '', 'profile_pic' => null],
    ];
}

function certPoints(?string $cert, string $target, string $issuer = ''): float {
    $r = ScoreEngine::compute(profileWithCert($cert, $issuer), 'job_title', $target);
    foreach ($r['breakdown'] as $f) if ($f['factor'] === 'certifications') return $f['points'];
    return -1;
}

echo "version\n";
ok(ScoreEngine::VERSION === 'cert-catalog-v2.3', "VERSION bumped to cert-catalog-v2.3 (was category-relevance-v2.2)");

echo "\nbaseline\n";
$none = certPoints(null, 'software engineer');
ok($none === 0.0, "no certs → 0 cert points");

echo "\ndirect relevance (famous certs the fuzzy matcher used to miss)\n";
$cases = [
    // [cert, issuer, target, expected-min-points, label]
    ['AWS Certified Solutions Architect - Associate', 'Amazon Web Services', 'software engineer', 4.0, 'AWS SA → Software Engineer'],
    ['CCNA', 'Cisco', 'network administrator', 4.0, 'CCNA → Network Administrator'],
    ['PMP', 'PMI', 'project manager', 4.0, 'PMP → Project Manager'],
    ['CompTIA Security+', 'CompTIA', 'security analyst', 4.0, 'Security+ → Security Analyst'],
    ['CPA', 'AICPA', 'accountant', 4.0, 'CPA → Accountant'],
    ['NCLEX-RN', '', 'registered nurse', 4.0, 'NCLEX-RN → Registered Nurse'],
    ['ServSafe Food Protection Manager', 'National Restaurant Association', 'restaurant manager', 4.0, 'ServSafe → Restaurant Manager'],
    ['CDL Class A', '', 'truck driver', 4.0, 'CDL → Truck Driver'],
    ['SHRM-CP', 'SHRM', 'human resources manager', 4.0, 'SHRM-CP → HR Manager'],
    ['OSHA 30', '', 'construction foreman', 4.0, 'OSHA 30 → Construction Foreman'],
    ['Real Estate Salesperson License', '', 'real estate agent', 4.0, 'RE License → Real Estate Agent'],
    ['Certified ScrumMaster', 'Scrum Alliance', 'product manager', 4.0, 'CSM → Product Manager'],
];
foreach ($cases as [$cert, $iss, $target, $min, $label]) {
    $p = certPoints($cert, $target, $iss);
    ok($p >= $min, sprintf("%s → %.1f pts (expect ≥ %.1f)", $label, $p, $min));
}

echo "\nunrelated certs stay at the floor\n";
$floor = [
    ['ServSafe Food Protection Manager', 'software engineer', 'ServSafe → Software Engineer'],
    ['CDL Class A', 'graphic designer', 'CDL → Graphic Designer'],
    ['CCNA', 'registered nurse', 'CCNA → Registered Nurse'],
    ['Cosmetology License', 'accountant', 'Cosmetology → Accountant'],
];
foreach ($floor as [$cert, $target, $label]) {
    $p = certPoints($cert, $target);
    ok($p <= 1.5, sprintf("%s → %.1f pts (expect ≤ 1.5 — floor, not boost)", $label, $p));
}

echo "\ngraded middle: adjacent-field certs land between floor and full\n";
// CCNA maps to IT/Infra + Cyber; Software (0) is adjacent to both.
$adj = certPoints('CCNA', 'software engineer', 'Cisco');
ok($adj > 1.5 && $adj < 4.0, sprintf("CCNA → Software Engineer: %.1f pts (adjacent — between 1.5 and 4)", $adj));

echo "\nordering: same cert, relevance-ranked targets\n";
$direct = certPoints('CompTIA Security+', 'security analyst', 'CompTIA');
$adjac  = certPoints('CompTIA Security+', 'software engineer', 'CompTIA');
$unrel  = certPoints('CompTIA Security+', 'chef', 'CompTIA');
ok($direct > $adjac && $adjac > $unrel,
   sprintf("Security+ pts: direct %.1f > adjacent %.1f > unrelated %.1f", $direct, $adjac, $unrel));

echo "\ncap respected\n";
$many = profileWithCert(null);
for ($i = 0; $i < 6; $i++) $many['certifications'][] = ['name' => 'AWS Certified Solutions Architect', 'issuer' => 'AWS'];
$r = ScoreEngine::compute($many, 'job_title', 'software engineer');
$pts = 0; foreach ($r['breakdown'] as $f) if ($f['factor'] === 'certifications') $pts = $f['points'];
ok($pts == 10.0, sprintf("6 relevant certs → %.1f pts (capped at W_CERTS=10)", $pts));

echo "\ncollision guard\n";
// "AWS" the welding society must not read as Amazon.
$weld = certPoints('Certified Welding Inspector', 'welder', 'American Welding Society');
ok($weld >= 4.0, sprintf("CWI (American Welding Society) → Welder: %.1f pts (welding, not Amazon)", $weld));
$weldVsSwe = certPoints('Certified Welding Inspector', 'software engineer', 'American Welding Society');
ok($weldVsSwe <= 1.5, sprintf("CWI → Software Engineer: %.1f pts (not boosted by the 'AWS' acronym)", $weldVsSwe));

echo "\nuncataloged certs still resolve (token + education-field fallbacks)\n";
$long = [
    // [cert, issuer, target, min pts, label]
    ['Fortinet NSE 4 Network Security', 'Fortinet', 'network administrator', 4.0, 'Fortinet NSE 4 (uncataloged) → Network Admin'],
    ['Advanced IT Fundamentals Certificate', '', 'systems administrator', 4.0, 'Generic IT cert (uncataloged) → Sysadmin'],
    ['Certificate in Accounting', 'Local Community College', 'accountant', 4.0, 'Certificate in Accounting (edu-field fallback) → Accountant'],
    ['Human Resource Management Certificate', '', 'human resources manager', 4.0, 'HR Management Certificate (edu-field fallback) → HR Manager'],
    ['Palo Alto Networks PCNSA', 'Palo Alto Networks', 'network administrator', 2.5, 'PCNSA (vendor uncataloged, "networks" token) → Network Admin'],
    ['Advanced Welding Techniques Certificate', 'Trade School', 'welder', 4.0, 'Welding techniques cert (uncataloged) → Welder'],
];
foreach ($long as [$cert, $iss, $target, $min, $label]) {
    $p = certPoints($cert, $target, $iss);
    ok($p >= $min, sprintf("%s → %.1f pts (expect ≥ %.1f)", $label, $p, $min));
}
// And uncataloged certs must still floor against unrelated targets.
$p = certPoints('Fortinet NSE 4 Network Security', 'chef', 'Fortinet');
ok($p <= 1.5, sprintf("Fortinet NSE 4 → Chef: %.1f pts (unrelated floor holds)", $p));

echo "\ndetail string\n";
$r = ScoreEngine::compute(profileWithCert('PMP', 'PMI'), 'job_title', 'project manager');
$detail = '';
foreach ($r['breakdown'] as $f) if ($f['factor'] === 'certifications') $detail = $f['detail'];
ok(str_contains($detail, '1 relevant'), "factor detail reports the relevant count ('$detail')");

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
