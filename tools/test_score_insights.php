<?php
// =====================================================================
// Live integration test for api/score/insights.php.
// Seeds several users with real scores against shared targets, hits the
// endpoint over real HTTP as a logged-in user, and asserts the
// aggregate maths (fair latest-per-user averages, percentile, trending
// ordering, minimum-pool gating) against hand-computed expectations.
//
// Run inside the same command chain that starts MariaDB + php -S; the
// servers do not survive between bash calls in the sandbox.
// =====================================================================

$BASE = getenv('API_BASE') ?: 'http://127.0.0.1:8000/api';
$pass = 0; $fail = 0;
function ok($c, $n) { global $pass, $fail; if ($c) { $pass++; echo "  ok  $n\n"; } else { $fail++; echo "  XX  $n\n"; } }

$pdo = new PDO('mysql:host=localhost;dbname=integrally;charset=utf8mb4', 'root', 'rootpw', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// --- clean slate for the tables we touch ---
$pdo->exec('DELETE FROM scores');
$pdo->exec('DELETE FROM hidden_scores');
$pdo->exec("DELETE FROM users WHERE username LIKE 'ins\\_%'");

// --- create 5 users ---
$uids = [];
$mk = $pdo->prepare("INSERT INTO users (uuid, username, email, password_hash, first_name, last_name, is_active, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, 1, NOW())");
for ($i = 1; $i <= 5; $i++) {
    $mk->execute(["uuid-ins-$i", "ins_user$i", "ins$i@t.co", password_hash('x', PASSWORD_DEFAULT), "Ins", "User$i"]);
    $uids[$i] = (int) $pdo->lastInsertId();
}

// --- seed scores. Design the pool so expectations are hand-checkable. ---
// job_title "Data Analyst": users 1..5 => 40,50,60,70,80  (avg 60)
//   plus user1 has an OLDER 10 (must be ignored: latest-per-user).
// field "Healthcare": users 1..3 => 30,60,90 (avg 60, pool 3 -> trends)
// skill "Python": users 1..2 => 55,65 (pool 2 -> below MIN_TREND_POOL=3,
//   must NOT appear in trending, but averages still count it).
$ins = $pdo->prepare("INSERT INTO scores (user_id, target_type, target_value, score_value, breakdown, algo_version, created_at)
                      VALUES (?, ?, ?, ?, NULL, 'v2.3', ?)");
$da = [40,50,60,70,80];
foreach ($da as $i => $v) $ins->execute([$uids[$i+1], 'job_title', 'Data Analyst', $v, '2026-07-20 10:00:00']);
// stale older score for user1 that must be superseded by 40 above:
$ins->execute([$uids[1], 'job_title', 'Data Analyst', 10, '2026-01-01 10:00:00']);
$hc = [30,60,90];
foreach ($hc as $i => $v) $ins->execute([$uids[$i+1], 'field', 'Healthcare', $v, '2026-07-25 10:00:00']);
$py = [55,65];
foreach ($py as $i => $v) $ins->execute([$uids[$i+1], 'skill', 'Python', $v, '2026-07-26 10:00:00']);

// --- log in as user3 (Data Analyst 60, Healthcare 90) via session cookie ---
// Hit login endpoint the same way the app does.
$cookie = tempnam(sys_get_temp_dir(), 'ins');
function req($url, $post = null, $cookie = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $cookie, CURLOPT_COOKIEFILE => $cookie]);
    if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($post)); curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']); }
    $body = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    return [$code, json_decode($body, true), $body];
}

// Give user3 a known password.
$pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([password_hash('secret123', PASSWORD_DEFAULT), $uids[3]]);
[$lc, $lj] = req("$GLOBALS[BASE]/auth/login.php", ['login' => 'ins_user3', 'password' => 'secret123'], $cookie);
ok($lc === 200, "login as user3 (HTTP $lc)");

[$code, $j, $raw] = req("$GLOBALS[BASE]/score/insights.php", null, $cookie);
ok($code === 200, "insights returns 200 (got $code)");
if ($code !== 200) { echo $raw . "\n"; echo "\n$pass passed, $fail failed\n"; exit($fail ? 1 : 0); }
$d = $j['data'] ?? $j;

// --- personal: user3 has Data Analyst 60 and Healthcare 90 ---
$byTarget = [];
foreach ($d['personal'] as $p) $byTarget[$p['target_type'].'|'.$p['target_value']] = $p;
ok(count($d['personal']) === 2, "user3 has 2 personal targets");
$daP = $byTarget['job_title|Data Analyst'] ?? null;
ok($daP && (int)$daP['score_value'] === 60, "user3 Data Analyst score is 60");
ok($daP && abs($daP['community_avg'] - 60.0) < 0.01, "Data Analyst community avg is 60 (stale 10 ignored)");
ok($daP && $daP['pool_size'] === 5, "Data Analyst pool_size is 5 (one per user, not 6)");
// user3=60 vs others 40,50,70,80 -> meets/beats 40,50 = 2 of 4 = 50th pct
ok($daP && $daP['percentile'] === 50, "user3 Data Analyst percentile 50 (got ".($daP['percentile']??'null').")");
$hcP = $byTarget['field|Healthcare'] ?? null;
ok($hcP && abs($hcP['community_avg'] - 60.0) < 0.01, "Healthcare community avg is 60");
ok($hcP && $hcP['percentile'] === 100, "user3 Healthcare (90) is top: percentile 100");

// --- personal_mean: (60+90)/2 = 75 ---
ok(abs($d['personal_mean'] - 75.0) < 0.01, "personal_mean is 75");

// --- averages.by_type ---
$bt = $d['averages']['by_type'];
ok(abs($bt['job_title']['avg'] - 60.0) < 0.01, "job_title avg 60");
ok($bt['job_title']['samples'] === 5, "job_title samples 5");
ok(abs($bt['field']['avg'] - 60.0) < 0.01, "field avg 60");
ok(abs($bt['skill']['avg'] - 60.0) < 0.01, "skill avg 60 (Python 55,65)");
ok($bt['skill']['samples'] === 2, "skill samples 2");
// overall = (5*60 + 3*60 + 2*60)/10 = 60
ok(abs($d['averages']['overall']['avg'] - 60.0) < 0.01, "overall avg 60");
ok($d['averages']['overall']['samples'] === 10, "overall samples 10");

// --- trending: Data Analyst (pool5) and Healthcare (pool3) qualify;
//     Python (pool2) is gated out by MIN_TREND_POOL=3. ---
$jtTrend = array_column($d['trending']['job_title'], 'target_value');
$fdTrend = array_column($d['trending']['field'], 'target_value');
$skTrend = array_column($d['trending']['skill'], 'target_value');
ok(in_array('Data Analyst', $jtTrend, true), "Data Analyst trends (job_title)");
ok(in_array('Healthcare', $fdTrend, true), "Healthcare trends (field)");
ok(!in_array('Python', $skTrend, true), "Python does NOT trend (pool 2 < 3)");
$da0 = $d['trending']['job_title'][0] ?? null;
ok($da0 && $da0['pool_size'] === 5 && abs($da0['avg'] - 60.0) < 0.01, "trending row carries pool_size + avg");

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
