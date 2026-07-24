<?php
require_once __DIR__ . '/../src/Mentions.php';
$pdo=Database::conn();
$p=0;$f=0; function ok($c,$n){global $p,$f; if($c){$p++;echo "  ✓ $n\n";}else{$f++;echo "  ✗ $n\n";}}
$cnt=fn($pid)=>(int)$pdo->query("SELECT COUNT(*) FROM post_mentions WHERE post_id=$pid AND comment_id IS NULL")->fetchColumn();
$ncnt=fn($pid)=>(int)$pdo->query("SELECT COUNT(*) FROM notifications WHERE post_id=$pid AND type='mention'")->fetchColumn();

$pdo->exec("DELETE FROM posts");
$pdo->exec("INSERT INTO posts (id,author_type,author_id,post_type,body,visibility) VALUES (100,'user',1,'text','hi @bob',	'public')");
$actor=['type'=>'user','id'=>1];

echo "\nsync() — create\n";
$n1=Mentions::sync(100,null,'hi @bob',$actor);
ok($n1===[2],"notifies bob on first sync");
ok($cnt(100)===1,"one mention row");
ok($ncnt(100)===1,"one notification");

echo "\nsync() — idempotence (re-save same body)\n";
$n2=Mentions::sync(100,null,'hi @bob',$actor);
ok($n2===[],"re-syncing identical body notifies nobody again");
ok($cnt(100)===1,"still exactly one row");
ok($ncnt(100)===1,"still exactly one notification");

echo "\nsync() — edit adds a mention\n";
$n3=Mentions::sync(100,null,'hi @bob and @dave',$actor);
ok($n3===[4],"only the NEWLY added user is notified");
ok($cnt(100)===2,"two rows now");

echo "\nsync() — edit removes a mention\n";
$n4=Mentions::sync(100,null,'hi @dave',$actor);
ok($n4===[],"removal notifies nobody");
ok($cnt(100)===1,"bob's row deleted");
$bobLeft=(int)$pdo->query("SELECT COUNT(*) FROM notifications WHERE post_id=100 AND recipient_id=2 AND type='mention'")->fetchColumn();
ok($bobLeft===0,"bob's notification withdrawn when he is no longer mentioned");

echo "\ncascade on delete\n";
$pdo->exec("DELETE FROM posts WHERE id=100");
ok($cnt(100)===0,"post_mentions cascade-deleted with the post");

echo "\n$p passed, $f failed\n";
exit($f?1:0);
