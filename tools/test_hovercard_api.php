<?php
// Integration test for api/profile/card.php against a live MariaDB.
// Exercises the privacy matrix, viewer relationships, and the action
// availability rules that drive the greyed-out buttons.
//
// Usage: php tools/test_hovercard_api.php  (expects the seeded fixture
// set and a PHP server on 127.0.0.1:8000 serving the app).

$BASE = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0;
function ok(bool $c, string $n): void {
    global $pass, $fail;
    if ($c) { $pass++; echo "  ✓ $n\n"; } else { $fail++; echo "  ✗ $n\n"; }
}

function req(string $url, ?string $jar = null, string $method = 'GET', ?array $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
    ]);
    if ($jar) { curl_setopt($ch, CURLOPT_COOKIEJAR, $jar); curl_setopt($ch, CURLOPT_COOKIEFILE, $jar); }
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    }
    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($raw, true)];
}

$card = fn(string $t, string $u, ?string $jar = null) => req("$GLOBALS[BASE]/profile/card.php?type=$t&uuid=$u", $jar);

echo "\ncard endpoint — anonymous\n";
[$c, $r] = $card('user', 'u-alice');
ok($c === 200 && $r['success'], 'anonymous can read a public user card');
$d = $r['data'] ?? [];
ok(($d['name'] ?? '') === 'Alice Nguyen', 'returns the display name');
ok(($d['headline'] ?? '') === 'Senior Data Engineer @ Acme Robotics', 'derives headline from the current job');
ok(($d['location'] ?? '') === 'Akron, OH', 'includes location when show_city is on');
ok(($d['score']['value'] ?? 0) === 87, 'returns the highest visible score');
ok(($d['score']['target_value'] ?? '') === 'Data Engineer', 'hidden individual scores are excluded');
ok(($d['viewer']['signed_in'] ?? true) === false, 'reports signed_in false');
ok(($d['message']['available'] ?? true) === false, 'message unavailable when signed out');
ok(!empty($d['message']['reason']), 'gives a reason so the button can explain itself');

echo "\ncard endpoint — privacy gates\n";
[$c, $r] = $card('user', 'u-carol');
ok($c === 404, 'discoverable=0 is 404 to anonymous');

[$c, $r] = $card('user', 'u-dave');
$d = $r['data'] ?? [];
ok($c === 200, 'a user who hides fields is still reachable');
ok(($d['location'] ?? null) === null, 'show_city=0 omits location');
ok(($d['score'] ?? null) === null, 'hide_all_scores=1 omits the score');
ok(($d['stats'] ?? null) === null, 'hide_follow_lists=1 omits counts');

echo "\ncard endpoint — signed-in relationships\n";
$jar = tempnam(sys_get_temp_dir(), 'jar');
req("$BASE/auth/login.php", $jar, 'POST', ['login' => 'bob', 'password' => 'Password123!']);

[$c, $r] = $card('user', 'u-alice', $jar);
$v = $r['data']['viewer'] ?? [];
ok(($v['following'] ?? false) === true, 'reports following when the viewer follows the target');
ok(($v['follows_me'] ?? false) === true, 'reports follows_me for a mutual follow');
ok(($r['data']['message']['available'] ?? false) === true, 'message available between unblocked users');

[$c, $r] = $card('user', 'u-bob', $jar);
ok(($r['data']['viewer']['is_self'] ?? false) === true, 'reports is_self on your own card');

[$c, $r] = $card('user', 'u-carol', $jar);
ok($c === 404, 'discoverable=0 is 404 to signed-in strangers too');

echo "\ncard endpoint — blocks\n";
[$c, $r] = $card('user', 'u-dave', $jar);
ok(($r['data']['viewer']['blocked'] ?? false) === true, 'reports the block');
ok(($r['data']['message']['available'] ?? true) === false, 'message unavailable across a block');
$reason = $r['data']['message']['reason'] ?? '';
ok($reason === 'Messaging unavailable', 'block reason is deliberately non-specific');
ok(stripos($reason, 'blocked') === false, 'reason never reveals that a block exists or its direction');

echo "\ncard endpoint — company\n";
[$c, $r] = $card('company', 'co-acme', $jar);
$d = $r['data'] ?? [];
ok($c === 200 && ($d['type'] ?? '') === 'company', 'company card resolves');
ok(($d['stats']['openings'] ?? -1) === 2, 'counts only OPEN roles');
ok(($d['viewer']['following'] ?? false) === true, 'reports company follow state');
ok(!isset($d['message']), 'company card carries no message block');
ok(mb_strlen($d['subtitle'] ?? '') <= 121, 'description is clamped for the card');

echo "\ncard endpoint — company actor\n";
$cjar = tempnam(sys_get_temp_dir(), 'cjar');
req("$BASE/company/login.php", $cjar, 'POST', ['login' => 'acme@ex.com', 'password' => 'Password123!']);
[$c, $r] = $card('user', 'u-alice', $cjar);
ok(($r['data']['message']['available'] ?? true) === false, 'a company actor cannot message a user');
ok(($r['data']['message']['reason'] ?? '') === 'Companies cannot send messages', 'explains why');

echo "\ncard endpoint — validation\n";
[$c, ] = req("$BASE/profile/card.php?type=bogus&uuid=x");
ok($c === 422, 'unknown type is 422');
[$c, ] = req("$BASE/profile/card.php?type=user");
ok($c === 422, 'missing uuid is 422');
[$c, ] = req("$BASE/profile/card.php?type=user&uuid=does-not-exist");
ok($c === 404, 'unknown uuid is 404');
[$c, ] = req("$BASE/profile/card.php?type=user&uuid=u-alice", null, 'POST');
ok($c === 405, 'POST is 405');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
