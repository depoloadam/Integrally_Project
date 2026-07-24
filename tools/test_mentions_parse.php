<?php
require_once __DIR__ . '/../src/Mentions.php';
$p=0;$f=0; function ok($c,$n){global $p,$f; if($c){$p++;echo "  ✓ $n\n";}else{$f++;echo "  ✗ $n\n";}}

echo "\nparse()\n";
ok(Mentions::parse("hey @alice")===['alice'],"plain mention");
ok(Mentions::parse("@alice and @bob")===['alice','bob'],"multiple");
ok(Mentions::parse("@alice @alice")===['alice'],"de-duplicated");
ok(Mentions::parse("@Alice")===['alice'],"lowercased");
ok(Mentions::parse("mail me at bob@example.com")===[],"email address is NOT a mention");
ok(Mentions::parse("a@b")===[],"mid-word @ ignored");
ok(Mentions::parse("hi @alice.")===['alice'],"trailing period trimmed");
ok(Mentions::parse("hi @alice, ok")===['alice'],"trailing comma excluded");
ok(Mentions::parse("<p>hey <strong>@alice</strong></p>")===['alice'],"HTML flattened");
ok(Mentions::parse('<a href="#user/@notreal">x</a>')===[],"tag attributes not parsed");
ok(Mentions::parse("")===[],"empty body");
ok(Mentions::parse("no mentions here")===[],"no matches");
ok(count(Mentions::parse(implode(' ', array_map(fn($i)=>"@u$i", range(1,40)))))===20,"capped at MAX_PER_BODY");

echo "\nresolve()\n";
$r=Mentions::resolve(['alice','bob']);
ok(isset($r['alice'])&&isset($r['bob']),"resolves real users");
ok($r['alice']['id']===1,"returns the right id");
$r2=Mentions::resolve(['carol']);
ok($r2===[],"non-discoverable user does NOT resolve");
$r3=Mentions::resolve(['nosuchuser']);
ok($r3===[],"unknown handle does not resolve");
$r4=Mentions::resolve(['alice'],1);
ok($r4===[],"author excluded (self-mention blocked)");
$r5=Mentions::resolve(['ALICE']);
ok(isset($r5['alice']),"case-insensitive match");

echo "\n$p passed, $f failed\n";
exit($f?1:0);
