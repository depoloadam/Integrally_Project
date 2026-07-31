<?php
// Live integration test for api/score/whatif.php.
// Seeds a user with a thin-ish profile, logs in over real HTTP, and:
//   - asserts a baseline score + per-factor headroom come back
//   - stages hypothetical additions and asserts the projected score MOVES
//     in the right direction with correct per-factor deltas
//   - asserts the endpoint NEVER writes (no new scores/skills/certs rows)
//   - checks the item caps and malformed-input tolerance
//
// Run inside the MariaDB + php -S chain (servers don't survive between
// bash calls in the sandbox).

$BASE = getenv('API_BASE') ?: 'http://127.0.0.1:8000/api';
$pass = 0; $fail = 0;
function ok($c, $n) { global $pass, $fail; if ($c) { $pass++; echo "  ok  $n\n"; } else { $fail++; echo "  XX  $n\n"; } }

$pdo = new PDO('mysql:host=localhost;dbname=integrally;charset=utf8mb4', 'root', 'rootpw', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// clean slate
$pdo->exec("DELETE FROM user_skills WHERE user_id IN (SELECT id FROM users WHERE username='wi_user')");
$pdo->exec("DELETE FROM certifications WHERE user_id IN (SELECT id FROM users WHERE username='wi_user')");
$pdo->exec("DELETE FROM education WHERE user_id IN (SELECT id FROM users WHERE username='wi_user')");
$pdo->exec("DELETE FROM job_history WHERE user_id IN (SELECT id FROM users WHERE username='wi_user')");
$pdo->exec("DELETE FROM scores WHERE user_id IN (SELECT id FROM users WHERE username='wi_user')");
$pdo->exec("DELETE FROM users WHERE username='wi_user'");

// user with onboarding complete (whatif itself doesn't gate, but keep it realistic)
$pdo->prepare("INSERT INTO users (uuid,username,email,password_hash,first_name,last_name,is_active,created_at)
               VALUES ('u-wi','wi_user','wi@t.co',?, 'Whatif','User',1,NOW())")
    ->execute([password_hash('secret123', PASSWORD_DEFAULT)]);
$uid = (int) $pdo->lastInsertId();

// a couple of years of relevant-ish experience so the baseline isn't zero
$pdo->prepare("INSERT INTO job_history (user_id,title,company_name,start_date,end_date)
               VALUES (?, 'Junior Data Analyst','Acme','2023-01-01','2025-01-01')")->execute([$uid]);
// one degree, unrelated field
$pdo->prepare("INSERT INTO education (user_id,institution,degree,field) VALUES (?, 'State U','BA','History')")->execute([$uid]);

function req($url, $post = null, $cookie = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $cookie, CURLOPT_COOKIEFILE => $cookie]);
    if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($post)); curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']); }
    $body = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return [$code, json_decode($body, true), $body];
}

$cookie = tempnam(sys_get_temp_dir(), 'wi');
[$lc] = req("$BASE/auth/login.php", ['login' => 'wi_user', 'password' => 'secret123'], $cookie);
ok($lc === 200, "login (HTTP $lc)");

$target = ['target_type' => 'job_title', 'target_value' => 'Data Analyst'];

// --- baseline only (no additions) ---
[$c0, $j0, $raw0] = req("$BASE/score/whatif.php", $target, $cookie);
ok($c0 === 200, "whatif returns 200 (got $c0)");
if ($c0 !== 200) { echo $raw0 . "\n\n$pass passed, $fail failed\n"; exit(1); }
$d0 = $j0['data'] ?? $j0;
ok(isset($d0['baseline']['score']), "baseline score present");
$baseScore = $d0['baseline']['score'];
ok(is_array($d0['baseline']['factors']) && count($d0['baseline']['factors']) >= 5, "baseline has per-factor breakdown");
// headroom present + sane on a factor with a known ceiling
$skillsFactor = null;
foreach ($d0['baseline']['factors'] as $f) if ($f['factor'] === 'skills_match') $skillsFactor = $f;
ok($skillsFactor && $skillsFactor['ceiling'] === 20, "skills_match ceiling is 20");
ok($skillsFactor && $skillsFactor['headroom'] >= 0 && $skillsFactor['headroom'] <= 20, "skills headroom within [0,20]");
ok($d0['projected'] === null && $d0['delta'] === null, "no projection when nothing staged");

// --- stage relevant additions -> score should RISE ---
$additions = ['additions' => ['skills' => [
    ['name' => 'SQL', 'proficiency' => 5],
    ['name' => 'Data Visualization', 'proficiency' => 4],
    ['name' => 'Python', 'proficiency' => 4],
]]];
[$c1, $j1] = req("$BASE/score/whatif.php", array_merge($target, $additions), $cookie);
ok($c1 === 200, "whatif with additions returns 200");
$d1 = $j1['data'] ?? $j1;
ok($d1['projected'] !== null, "projection present when items staged");
ok($d1['applied']['skills'] === 3, "3 skills applied");
ok($d1['projected']['score'] > $baseScore, "adding relevant skills raises the score ($baseScore -> {$d1['projected']['score']})");
ok(abs($d1['delta'] - round($d1['projected']['score'] - $baseScore, 1)) < 0.01, "delta equals projected minus baseline");
// the movement should be on the skills factor
$skDelta = null;
foreach ($d1['factor_deltas'] as $fd) if ($fd['factor'] === 'skills_match') $skDelta = $fd;
ok($skDelta && $skDelta['change'] > 0, "skills_match factor increased");
ok($skDelta && abs($skDelta['after'] - ($skDelta['before'] + $skDelta['change'])) < 0.01, "factor delta arithmetic is consistent");

// --- a relevant cert + relevant degree also help ---
$more = ['additions' => [
    'certifications' => [['name' => 'Google Data Analytics Certificate', 'issuer' => 'Google']],
    'education' => [['degree' => 'BS', 'field' => 'Computer Science']],
]];
[$c2, $j2] = req("$BASE/score/whatif.php", array_merge($target, $more), $cookie);
$d2 = $j2['data'] ?? $j2;
ok($d2['projected']['score'] > $baseScore, "cert + relevant degree raise the score too");
ok($d2['applied']['certifications'] === 1 && $d2['applied']['education'] === 1, "cert + education applied");

// --- caps: 30 skills staged, only 25 counted ---
$big = ['additions' => ['skills' => array_map(fn($i) => ['name' => "skill$i"], range(1, 30))]];
[$c3, $j3] = req("$BASE/score/whatif.php", array_merge($target, $big), $cookie);
$d3 = $j3['data'] ?? $j3;
ok($d3['applied']['skills'] === 25, "per-type cap of 25 enforced (staged 30)");

// --- malformed items are skipped, not fatal ---
$bad = ['additions' => ['skills' => [['name' => ''], ['proficiency' => 3], ['name' => 'Valid Skill']]]];
[$c4, $j4] = req("$BASE/score/whatif.php", array_merge($target, $bad), $cookie);
$d4 = $j4['data'] ?? $j4;
ok($c4 === 200 && $d4['applied']['skills'] === 1, "malformed skills skipped, valid one kept");

// --- CRITICAL: the endpoint must NOT have written anything ---
$scoreCount = $pdo->query("SELECT COUNT(*) FROM scores WHERE user_id=$uid")->fetchColumn();
$skillCount = $pdo->query("SELECT COUNT(*) FROM user_skills WHERE user_id=$uid")->fetchColumn();
$certCount  = $pdo->query("SELECT COUNT(*) FROM certifications WHERE user_id=$uid")->fetchColumn();
ok((int)$scoreCount === 0, "whatif stored NO score row (recompute-only)");
ok((int)$skillCount === 0, "whatif stored NO skills");
ok((int)$certCount === 0, "whatif stored NO certifications");

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
