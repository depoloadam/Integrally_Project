<?php
// =====================================================================
// tools/test_public_activity.php
// Verifies the personal (activity) feed endpoint used on the public
// profile respects post visibility: a non-follower sees only public
// posts; a follower and the owner also see 'followers'-only posts.
// =====================================================================

$API = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0; $fails = [];

function jar($n){ return sys_get_temp_dir()."/pa_$n.cookies"; }
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
$author=$uuid('pa_author');

echo "== login ==\n";
check('author login',   login('author','pa_author'));
check('follower login', login('follower','pa_follower'));
check('stranger login', login('stranger','pa_stranger'));

$base = "$API/posts/personal.php?type=user&uuid=$author&limit=10&offset=0";

echo "\n== non-follower sees only public ==\n";
$r = req('GET',$base,null,'stranger');
check('stranger 200', $r['code']===200, "code={$r['code']}");
$posts = $r['json']['data']['posts'] ?? [];
check('stranger sees exactly 1 (public only)', count($posts)===1, "got ".count($posts));
check('stranger has_more false', ($r['json']['data']['has_more'] ?? null)===false);

echo "\n== guest (no session) sees only public ==\n";
$r = req('GET',$base,null,null);
check('guest 200', $r['code']===200);
check('guest sees 1 public post', count($r['json']['data']['posts'] ?? [])===1);

echo "\n== follower sees public + followers-only ==\n";
$r = req('GET',$base,null,'follower');
check('follower 200', $r['code']===200);
check('follower sees 2 posts', count($r['json']['data']['posts'] ?? [])===2, "got ".count($r['json']['data']['posts'] ?? []));

echo "\n== owner sees both ==\n";
$r = req('GET',$base,null,'author');
check('owner 200', $r['code']===200);
check('owner sees 2 posts', count($r['json']['data']['posts'] ?? [])===2);
check('author info returned', !empty($r['json']['data']['author']['uuid']));

echo "\n=================  $pass passed, $fail failed  =================\n";
if($fail){echo "FAILURES: ".implode(', ',$fails)."\n";exit(1);}
exit(0);
