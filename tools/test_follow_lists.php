<?php
// =====================================================================
// tools/test_follow_lists.php
// Real HTTP integration test for the clickable follower/following lists
// and the hide_follow_lists privacy gate. Assumes the PHP built-in
// server is running at API_BASE with a seeded MariaDB (see the runner).
// =====================================================================

$API = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0; $fails = [];

function jar($name) { return sys_get_temp_dir() . "/fl_$name.cookies"; }

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
    return ['code' => $code, 'json' => json_decode($raw, true), 'raw' => $raw];
}

function check($name, $cond, $detail = '') {
    global $pass, $fail, $fails;
    if ($cond) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; $fails[] = $name; echo "  FAIL $name  $detail\n"; }
}

function login($name, $login, $password) {
    global $API;
    $r = req('POST', "$API/auth/login.php", ['login' => $login, 'password' => $password], $name);
    return $r['code'] === 200 && !empty($r['json']['success']);
}

// --- Resolve seeded uuids ------------------------------------------------
$pdo = new PDO('mysql:host=127.0.0.1;dbname=integrally;charset=utf8mb4', 'root', '');
$uuid = function($username) use ($pdo) {
    $s = $pdo->prepare('SELECT uuid FROM users WHERE username = ?');
    $s->execute([$username]);
    return $s->fetchColumn();
};
$alice = $uuid('fl_alice');   // target, has followers, hides lists later
$bob   = $uuid('fl_bob');     // follows alice
$carol = $uuid('fl_carol');   // follows alice; viewer

echo "== login ==\n";
check('alice login', login('alice', 'fl_alice', 'password123'));
check('bob login',   login('bob',   'fl_bob',   'password123'));
check('carol login', login('carol', 'fl_carol', 'password123'));

echo "\n== counts endpoint ==\n";
$c = req('GET', "$API/follow/counts.php?type=user&uuid=$alice", null, 'carol');
check('counts 200', $c['code'] === 200);
check('alice has 2 followers', ($c['json']['data']['followers'] ?? null) === 2, json_encode($c['json']['data'] ?? null));
check('lists_hidden false by default', ($c['json']['data']['lists_hidden'] ?? null) === false);

echo "\n== followers list (public) ==\n";
$f = req('GET', "$API/follow/followers.php?type=user&uuid=$alice", null, 'carol');
check('followers 200', $f['code'] === 200);
$names = array_column($f['json']['data'] ?? [], 'name');
check('followers include bob + carol', in_array('fl_bob', $names) && in_array('fl_carol', $names), json_encode($names));
check('follower rows carry uuid', !empty($f['json']['data'][0]['uuid']));
check('follower rows carry follower_type', !empty($f['json']['data'][0]['follower_type']));

echo "\n== following list (public) ==\n";
$g = req('GET', "$API/follow/following.php?uuid=$bob", null, 'carol');
check('following 200', $g['code'] === 200);
$gn = array_column($g['json']['data'] ?? [], 'name');
check('bob follows alice', in_array('fl_alice', $gn), json_encode($gn));

echo "\n== enable hide_follow_lists on alice ==\n";
$s = req('POST', "$API/settings/set.php", ['key' => 'hide_follow_lists', 'value' => '1'], 'alice');
check('setting saved', $s['code'] === 200 && !empty($s['json']['success']));

echo "\n== gate: non-owner blocked ==\n";
$f2 = req('GET', "$API/follow/followers.php?type=user&uuid=$alice", null, 'carol');
check('followers 403 for non-owner', $f2['code'] === 403, "code={$f2['code']}");
check('followers error code flagged', ($f2['json']['code'] ?? null) === 'follow_lists_hidden', json_encode($f2['json']));

$g2 = req('GET', "$API/follow/following.php?uuid=$alice", null, 'carol');
check('following 403 for non-owner', $g2['code'] === 403, "code={$g2['code']}");
check('following error code flagged', ($g2['json']['code'] ?? null) === 'follow_lists_hidden');

echo "\n== gate: counts still visible + hidden flag ==\n";
$c2 = req('GET', "$API/follow/counts.php?type=user&uuid=$alice", null, 'carol');
check('counts still 200 when hidden', $c2['code'] === 200);
check('follower count still returned', ($c2['json']['data']['followers'] ?? null) === 2);
check('lists_hidden true for non-owner', ($c2['json']['data']['lists_hidden'] ?? null) === true);

echo "\n== gate: owner still sees own lists ==\n";
$f3 = req('GET', "$API/follow/followers.php?type=user&uuid=$alice", null, 'alice');
check('owner followers 200 despite hide', $f3['code'] === 200, "code={$f3['code']}");
check('owner sees both followers', count($f3['json']['data'] ?? []) === 2);
$c3 = req('GET', "$API/follow/counts.php?type=user&uuid=$alice", null, 'alice');
check('owner counts lists_hidden false', ($c3['json']['data']['lists_hidden'] ?? null) === false);

echo "\n== gate: guest (no session) blocked ==\n";
$f4 = req('GET', "$API/follow/followers.php?type=user&uuid=$alice", null, null);
check('guest followers 403 when hidden', $f4['code'] === 403, "code={$f4['code']}");

echo "\n== turn hide back off ==\n";
req('POST', "$API/settings/set.php", ['key' => 'hide_follow_lists', 'value' => '0'], 'alice');
$f5 = req('GET', "$API/follow/followers.php?type=user&uuid=$alice", null, 'carol');
check('followers visible again after off', $f5['code'] === 200);

echo "\n=================  $pass passed, $fail failed  =================\n";
if ($fail) { echo "FAILURES: " . implode(', ', $fails) . "\n"; exit(1); }
exit(0);
