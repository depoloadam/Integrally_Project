<?php
// =====================================================================
// tools/test_period_filter.php
// Verifies the ?period= time-window filter on the four sortable post
// surfaces: feed/main, feed/explore, posts/personal, posts/saved.
// Posts are seeded at known ages; each period must return the right
// subset, and an invalid period must fall back to 'all'.
// =====================================================================

$API = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0; $fails = [];

function jar($n){ return sys_get_temp_dir()."/pf_$n.cookies"; }
function req($m,$u,$b=null,$c=null){
    $ch=curl_init($u);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$m,CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);
    if($c){curl_setopt($ch,CURLOPT_COOKIEJAR,jar($c));curl_setopt($ch,CURLOPT_COOKIEFILE,jar($c));}
    if($b!==null)curl_setopt($ch,CURLOPT_POSTFIELDS,json_encode($b));
    $r=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    return['code'=>$code,'json'=>json_decode($r,true)];
}
function check($n,$c,$d=''){global $pass,$fail,$fails; if($c){$pass++;echo "  ok   $n\n";}else{$fail++;$fails[]=$n;echo "  FAIL $n  $d\n";}}
function login($n,$l){global $API; $r=req('POST',"$API/auth/login.php",['login'=>$l,'password'=>'password123'],$n); return $r['code']===200 && !empty($r['json']['success']);}

$pdo=new PDO('mysql:host=127.0.0.1;dbname=integrally;charset=utf8mb4','root','');
$uuid=function($u)use($pdo){$s=$pdo->prepare('SELECT uuid FROM users WHERE username=?');$s->execute([$u]);return $s->fetchColumn();};
$author=$uuid('pf_author');

echo "== login ==\n";
check('author login', login('author','pf_author'));

// Seeded ages (see runner): 1 post 2h old, 1 post 5d old, 1 post 20d old,
// 1 post 200d old, 1 post 800d old  => 5 total public posts.
// Expected counts by period on a single author's PERSONAL feed:
//   all=5, today(<=1d)=1, week(<=7d)=2, month(<=30d)=3, year(<=365d)=4
$expect = ['all'=>5,'today'=>1,'week'=>2,'month'=>3,'year'=>4];

echo "\n== personal feed period filter ==\n";
foreach ($expect as $period=>$n) {
    $r = req('GET', "$API/posts/personal.php?type=user&uuid=$author&limit=50&period=$period", null, 'author');
    $got = count($r['json']['data']['posts'] ?? []);
    check("personal period=$period returns $n", $got === $n, "got $got (code {$r['code']})");
}

echo "\n== personal: has_more honest under period ==\n";
// limit 1, period=week (2 posts) -> has_more true; period=today (1) -> false
$r = req('GET', "$API/posts/personal.php?type=user&uuid=$author&limit=1&period=week", null, 'author');
check('week limit1 has_more true', ($r['json']['data']['has_more'] ?? null) === true);
$r = req('GET', "$API/posts/personal.php?type=user&uuid=$author&limit=1&period=today", null, 'author');
check('today limit1 has_more false', ($r['json']['data']['has_more'] ?? null) === false);

echo "\n== invalid period falls back to all ==\n";
$r = req('GET', "$API/posts/personal.php?type=user&uuid=$author&limit=50&period=bogus", null, 'author');
check('bogus period -> all (5)', count($r['json']['data']['posts'] ?? []) === 5, "got ".count($r['json']['data']['posts'] ?? []));

echo "\n== explore feed period filter (public) ==\n";
// Explore excludes the viewer's OWN posts; view as a DIFFERENT user.
check('viewer login', login('viewer','pf_viewer'));
foreach (['all'=>5,'today'=>1,'month'=>3] as $period=>$n) {
    $r = req('GET', "$API/feed/explore.php?period=$period&sort=newest", null, 'viewer');
    // Explore may include other seeded posts from other tests; filter to our author.
    $items = $r['json']['data']['items'] ?? [];
    $mine = array_filter($items, fn($it)=>($it['author']['uuid'] ?? '') === $author);
    check("explore period=$period includes $n of author's", count($mine) === $n, "got ".count($mine));
}

echo "\n== period combines with sort (oldest) ==\n";
$r = req('GET', "$API/posts/personal.php?type=user&uuid=$author&limit=50&period=month&sort=oldest", null, 'author');
$posts = $r['json']['data']['posts'] ?? [];
check('month+oldest returns 3', count($posts) === 3);
// oldest first: created_at ascending
$asc = true;
for ($i=1;$i<count($posts);$i++){ if (strcmp($posts[$i-1]['created_at'],$posts[$i]['created_at'])>0){$asc=false;break;} }
check('month+oldest is ascending by created_at', $asc);

echo "\n== saved list period filter (on post creation time) ==\n";
// The runner saved ALL of author's posts for the author. Period filters
// on the POST's created_at, same windows as elsewhere.
foreach (['all'=>5,'today'=>1,'week'=>2,'month'=>3] as $period=>$n) {
    $r = req('GET', "$API/posts/saved.php?period=$period&sort=saved", null, 'author');
    $got = count($r['json']['data']['items'] ?? []);
    check("saved period=$period returns $n", $got === $n, "got $got (code {$r['code']})");
}

echo "\n=================  $pass passed, $fail failed  =================\n";
if($fail){echo "FAILURES: ".implode(', ',$fails)."\n";exit(1);}
exit(0);
