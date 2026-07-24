<?php
// End-to-end integration test for @mentions over real HTTP.
// Expects the seeded fixture set (alice/bob/carol/dave) and a PHP server
// on 127.0.0.1:8000 serving the app.
//
// Fixture roles:
//   alice — author
//   bob   — ordinary mentionable user
//   carol — discoverable='0'   (opted out of discovery)
//   dave  — notify_mention='0' (wants the link, not the alert)

$BASE = getenv('API_BASE') ?: 'http://127.0.0.1:8000/integrally/api';
$pass = 0; $fail = 0;
function ok(bool $c, string $n): void {
    global $pass, $fail;
    if ($c) { $pass++; echo "  ✓ $n\n"; } else { $fail++; echo "  ✗ $n\n"; }
}
function req(string $url, ?string $jar = null, string $method = 'GET', ?array $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method]);
    if ($jar) { curl_setopt($ch, CURLOPT_COOKIEJAR, $jar); curl_setopt($ch, CURLOPT_COOKIEFILE, $jar); }
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    }
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($raw, true)];
}

require_once __DIR__ . '/../src/Database.php';
$pdo = Database::conn();
$pdo->exec('DELETE FROM notifications');
$pdo->exec('DELETE FROM post_mentions');
$pdo->exec('DELETE FROM post_comments');
$pdo->exec('DELETE FROM posts');
$pdo->exec('TRUNCATE TABLE rate_limits');

$aliceJar = tempnam(sys_get_temp_dir(), 'a');
$bobJar   = tempnam(sys_get_temp_dir(), 'b');
req("$BASE/auth/login.php", $aliceJar, 'POST', ['login' => 'alice', 'password' => 'Password123!']);
req("$BASE/auth/login.php", $bobJar,   'POST', ['login' => 'bob',   'password' => 'Password123!']);

echo "\nmentions — post creation\n";
[$c, $r] = req("$BASE/posts/create.php", $aliceJar, 'POST', [
    'body' => 'morning <strong>@bob</strong> and @carol and @dave and @alice and @ghost',
]);
ok($c === 201 && $r['success'], 'post created');
$postId = (int) $r['data']['id'];
$mentioned = $r['data']['mentioned'] ?? [];
ok(count($mentioned) === 2, 'exactly two users were notified');

$rows = $pdo->query("SELECT u.username FROM post_mentions pm JOIN users u ON u.id=pm.mentioned_id WHERE pm.post_id=$postId AND pm.comment_id IS NULL ORDER BY u.username")->fetchAll(PDO::FETCH_COLUMN);
ok($rows === ['bob', 'dave'], 'rows recorded for bob and dave only');
ok(!in_array('carol', $rows, true), 'a non-discoverable user is not mentionable');
ok(!in_array('alice', $rows, true), 'self-mention is blocked entirely');

$notified = $pdo->query("SELECT u.username FROM notifications n JOIN users u ON u.id=n.recipient_id WHERE n.type='mention' ORDER BY u.username")->fetchAll(PDO::FETCH_COLUMN);
ok($notified === ['bob'], 'only bob is notified — dave has notify_mention off');
ok(in_array('dave', $rows, true), "dave's mention is still recorded and linked despite the toggle");

echo "\nmentions — rendering\n";
[$c, $r] = req("$BASE/posts/get.php?id=$postId", $aliceJar);
$body = $r['data']['body'] ?? '';
ok(str_contains($body, 'class="in-mention"'), 'resolved mentions render as links');
ok(str_contains($body, 'data-hover-card="user"'), 'mention links carry hover-card attributes');
ok(str_contains($body, 'href="#user/u-bob"'), 'link points at the uuid route');
ok(str_contains($body, '@carol') && !str_contains($body, 'u-carol'), 'unresolved handle stays literal text');
ok(str_contains($body, '@ghost'), 'unknown handle stays literal text');
ok(str_contains($body, '<strong>'), 'existing formatting is preserved');

echo "\nmentions — comments\n";
[$c, $r] = req("$BASE/posts/comment-add.php", $bobJar, 'POST', [
    'post_id' => $postId, 'body' => 'thanks @alice! also @carol @bob',
]);
ok($c === 201, 'comment created');
$commentId = (int) $r['data']['id'];
ok(($r['data']['mentioned'] ?? []) === [1], 'alice notified; carol unresolved, bob is self');

$cm = $pdo->query("SELECT post_id FROM post_mentions WHERE comment_id=$commentId")->fetchColumn();
ok((int) $cm === $postId, 'comment mention is anchored to its post for notification enrichment');

[$c, $r] = req("$BASE/posts/comment-list.php?post_id=$postId", $bobJar);
$cmt = $r['data']['comments'][0] ?? [];
ok(str_contains($cmt['body_html'] ?? '', 'class="in-mention"'), 'comment body_html carries mention links');
ok(!str_contains($cmt['body'] ?? '', '<a'), 'raw body stays plain text');

echo "\nmentions — notification payload\n";
[$c, $r] = req("$BASE/notifications/list.php", $bobJar);
$ns = $r['data']['notifications'] ?? [];
$mention = null;
foreach ($ns as $n) if ($n['type'] === 'mention') { $mention = $n; break; }
ok($mention !== null, 'mention appears in the recipient\'s notifications');
ok(($mention['post']['id'] ?? 0) === $postId, 'post snippet resolved from post_id');
ok(array_key_exists('comment_id', $mention), 'comment_id is exposed so the client can pick the verb');
ok($mention['comment_id'] === null, 'a post mention has a null comment_id');

echo "\nmentions — typeahead endpoint\n";
[$c, $r] = req("$BASE/mentions/search.php?q=bo", $aliceJar);
$names = array_column($r['data']['results'] ?? [], 'username');
ok(in_array('bob', $names, true), 'prefix search finds bob');
ok(!in_array('carol', $names, true), 'non-discoverable users are excluded');
[$c, $r] = req("$BASE/mentions/search.php?q=car", $aliceJar);
ok(!in_array('carol', array_column($r['data']['results'] ?? [], 'username'), true), 'carol is not offered even by exact prefix');
[$c, $r] = req("$BASE/mentions/search.php?q=ali", $aliceJar);
ok(!in_array('alice', array_column($r['data']['results'] ?? [], 'username'), true), 'the requester is never offered to themselves');
[$c, $r] = req("$BASE/mentions/search.php?q=", $aliceJar);
ok(($r['data']['results'] ?? null) === [], 'a bare @ returns nothing rather than scanning');
[$c, ] = req("$BASE/mentions/search.php?q=bo", null);
ok($c === 401, 'signed-out callers are rejected');
[$c, ] = req("$BASE/mentions/search.php?q=bo", $aliceJar, 'POST');
ok($c === 405, 'POST is rejected');

echo "\nmentions — deletion\n";
$before = (int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE post_id=$postId")->fetchColumn();
ok($before > 0, 'notifications exist before deletion');
[$c, $r] = req("$BASE/posts/delete.php", $aliceJar, 'POST', ['id' => $postId]);
ok($c === 200 && $r['success'], 'post deleted');
ok((int) $pdo->query("SELECT COUNT(*) FROM post_mentions WHERE post_id=$postId")->fetchColumn() === 0,
   'post_mentions cascade away with the post');
ok((int) $pdo->query("SELECT COUNT(*) FROM notifications WHERE post_id=$postId")->fetchColumn() === 0,
   'notifications for the deleted post are cleared (no orphaned bell items)');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
