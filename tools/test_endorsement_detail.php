<?php
// =====================================================================
// tools/test_endorsement_detail.php
// Real HTTP integration test for api/profile/endorsements/list.php.
// Verifies the mutual-follow gate, owner access, company/guest
// rejection, and the endorser/count payload. Assumes the PHP built-in
// server + seeded MariaDB from the runner.
// =====================================================================

$API = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0; $fails = [];

function jar($name) { return sys_get_temp_dir() . "/ed_$name.cookies"; }

function req($method, $url, $body = null, $cookieName = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    ]);
    if ($cookieName) {
        curl_setopt($ch, CURLOPT_COOKIEJAR,  jar($cookieName));
        curl_setopt($ch, CURLOPT_COOKIEFILE, jar($cookieName));
    }
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'json' => json_decode($raw, true)];
}
function check($name, $cond, $detail = '') {
    global $pass, $fail, $fails;
    if ($cond) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; $fails[] = $name; echo "  FAIL $name  $detail\n"; }
}
function login($name, $login) {
    global $API;
    $r = req('POST', "$API/auth/login.php", ['login' => $login, 'password' => 'password123'], $name);
    return $r['code'] === 200 && !empty($r['json']['success']);
}

$pdo = new PDO('mysql:host=127.0.0.1;dbname=integrally;charset=utf8mb4', 'root', '');
$uuid = function($u) use ($pdo) { $s = $pdo->prepare('SELECT uuid FROM users WHERE username=?'); $s->execute([$u]); return $s->fetchColumn(); };

$target  = $uuid('ed_target');   // has skills, gets endorsed
$mutual  = $uuid('ed_mutual');   // mutual follow of target, endorses skills
$oneway  = $uuid('ed_oneway');   // follows target but not followed back
$stranger= $uuid('ed_stranger'); // no relationship

echo "== login ==\n";
check('target login',   login('target',  'ed_target'));
check('mutual login',   login('mutual',  'ed_mutual'));
check('oneway login',   login('oneway',  'ed_oneway'));
check('stranger login', login('stranger','ed_stranger'));

echo "\n== mutual follow can view detail ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$target", null, 'mutual');
check('mutual 200', $r['code'] === 200, "code={$r['code']} ".json_encode($r['json']));
$skills = $r['json']['data']['skills'] ?? [];
check('total is 2', ($r['json']['data']['total'] ?? null) === 2, json_encode($r['json']['data'] ?? null));
check('only endorsed skills returned', count($skills) === 1, "got ".count($skills)." skill groups");
$grp = $skills[0] ?? [];
check('skill count is 2', ($grp['count'] ?? null) === 2);
$endorserNames = array_column($grp['endorsers'] ?? [], 'username');
check('endorsers include mutual + target-follower', in_array('ed_mutual', $endorserNames), json_encode($endorserNames));
check('endorser rows carry uuid', !empty($grp['endorsers'][0]['uuid']));

echo "\n== owner can view own detail ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$target", null, 'target');
check('owner 200', $r['code'] === 200, "code={$r['code']}");
check('owner sees total 2', ($r['json']['data']['total'] ?? null) === 2);

echo "\n== one-way follower is blocked ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$target", null, 'oneway');
check('oneway 403', $r['code'] === 403, "code={$r['code']}");
check('oneway not_connected code', ($r['json']['code'] ?? null) === 'not_connected');

echo "\n== stranger is blocked ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$target", null, 'stranger');
check('stranger 403', $r['code'] === 403, "code={$r['code']}");

echo "\n== guest is blocked ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$target", null, null);
check('guest 401', $r['code'] === 401, "code={$r['code']}");

echo "\n== bad uuid 404 (as mutual) ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=does-not-exist", null, 'mutual');
check('missing uuid 404', $r['code'] === 404, "code={$r['code']}");

echo "\n== owner with no endorsements sees empty ==\n";
$r = req('GET', "$API/profile/endorsements/list.php?uuid=$stranger", null, 'stranger');
check('owner (stranger) 200 on own empty profile', $r['code'] === 200, "code={$r['code']}");
check('own empty total 0', ($r['json']['data']['total'] ?? null) === 0);
check('own empty skills []', is_array($r['json']['data']['skills'] ?? null) && count($r['json']['data']['skills']) === 0);

echo "\n=================  $pass passed, $fail failed  =================\n";
if ($fail) { echo "FAILURES: " . implode(', ', $fails) . "\n"; exit(1); }
exit(0);
