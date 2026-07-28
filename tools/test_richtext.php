<?php
// Behavioral tests for src/RichText.php after the block/link expansion.
// This is a SECURITY BOUNDARY: the editor is untrusted, so the bulk of
// these are injection attempts. Also covers backward compatibility with
// the existing execCommand editor's output, and idempotence (job
// descriptions are re-sanitized on every update).

require_once __DIR__ . '/../src/RichText.php';

$pass = 0; $fail = 0;
function ok(bool $c, string $n): void {
    global $pass, $fail;
    if ($c) { $pass++; echo "  \xE2\x9C\x93 $n\n"; }
    else    { $fail++; echo "  \xE2\x9C\x97 $n\n"; }
}
function eq($got, $want, string $n): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  \xE2\x9C\x93 $n\n"; }
    else { $fail++; echo "  \xE2\x9C\x97 $n\n      want: $want\n      got:  $got\n"; }
}
function clean(string $s): string { return RichText::clean($s); }

echo "XSS / injection (the reason this class exists)\n";
$attacks = [
    '<script>alert(1)</script>'                          => 'script tag',
    '<img src=x onerror="alert(1)">'                     => 'img onerror',
    '<svg/onload=alert(1)>'                              => 'svg onload',
    '<iframe src="evil"></iframe>'                       => 'iframe',
    '<b onclick="alert(1)">hi</b>'                       => 'event handler on allowed tag',
    '<object data="x"></object>'                         => 'object tag',
    '<style>body{display:none}</style>'                   => 'style tag',
    '<form><input name=x></form>'                        => 'form/input',
];
foreach ($attacks as $payload => $label) {
    $out = clean($payload);
    ok(stripos($out, 'script') === false
       && stripos($out, 'onerror') === false
       && stripos($out, 'onclick') === false
       && stripos($out, 'onload') === false
       && stripos($out, '<iframe') === false
       && stripos($out, '<object') === false
       && stripos($out, '<form') === false
       && stripos($out, '<input') === false, "blocked: $label");
}
// content is preserved as text where sensible
ok(strpos(clean('<b onclick="alert(1)">hi</b>'), 'hi') !== false, "allowed tag survives, handler stripped");

echo "\nlink scheme whitelist (obfuscation must fail by construction)\n";
$badHrefs = [
    'javascript:alert(1)'            => 'javascript:',
    'JaVaScRiPt:alert(1)'            => 'mixed-case javascript:',
    "java\tscript:alert(1)"          => 'tab-split scheme',
    "java\nscript:alert(1)"          => 'newline-split scheme',
    '&#106;avascript:alert(1)'       => 'entity-encoded scheme',
    'data:text/html;base64,PHNjcmlwdD4=' => 'data: URI',
    'vbscript:msgbox(1)'             => 'vbscript:',
    '  javascript:alert(1)'          => 'leading-whitespace scheme',
    '/relative/path'                 => 'relative URL (not absolute)',
    '//evil.com'                     => 'scheme-relative URL',
];
foreach ($badHrefs as $href => $label) {
    $out = clean('<a href="' . $href . '">click</a>');
    ok(stripos($out, '<a ') === false && stripos($out, 'href') === false, "rejected href: $label");
    ok(strpos($out, 'click') !== false, "  ...but link text kept: $label");
}

echo "\nvalid links\n";
eq(clean('<a href="https://example.com/x?a=1">site</a>'),
   '<a href="https://example.com/x?a=1" rel="nofollow noopener noreferrer" target="_blank">site</a>',
   'https link kept with rel + target');
ok(strpos(clean('<a href="http://example.com">x</a>'), 'href="http://example.com"') !== false, 'http link kept');
ok(strpos(clean('<a href="mailto:a@b.com">mail</a>'), 'mailto:a@b.com') !== false, 'mailto kept');
// attribute-injection attempt via a quote inside href
$inj = clean('<a href="https://e.com/&quot; onmouseover=&quot;alert(1)">x</a>');
ok(stripos($inj, 'onmouseover') === false, 'quote-injection in href cannot break out of the attribute');

echo "\nnew block formats\n";
eq(clean('<ul><li>one</li><li>two</li></ul>'), '<ul><li>one</li><li>two</li></ul>', 'bulleted list');
eq(clean('<ol><li>one</li></ol>'), '<ol><li>one</li></ol>', 'numbered list');
ok(strpos(clean('<ul><li>a<ul><li>b</li></ul></li></ul>'), '<ul><li>b</li></ul>') !== false, 'nested list survives');
eq(clean('<blockquote>quoted</blockquote>'), '<blockquote>quoted</blockquote>', 'blockquote');
eq(clean('<pre>code here</pre>'), '<pre>code here</pre>', 'code block');
eq(clean('<p>hello <code>x=1</code></p>'), '<p>hello <code>x=1</code></p>', 'paragraph + inline code');
eq(clean('<h2>Head</h2>'), '<h2>Head</h2>', 'h2 kept');
eq(clean('<h1>Head</h1>'), '<h2>Head</h2>', 'h1 clamped to h2 (no page-level heading in posts)');
eq(clean('<h5>Head</h5>'), '<h3>Head</h3>', 'h5 clamped to h3');

echo "\nalignment (fixed enum, never echoes user input)\n";
eq(clean('<p class="ql-align-center">c</p>'), '<p class="rt-align-center">c</p>', 'Quill align class normalised');
eq(clean('<p class="rt-align-right">r</p>'), '<p class="rt-align-right">r</p>', 'canonical class round-trips');
eq(clean('<p style="text-align:justify">j</p>'), '<p class="rt-align-justify">j</p>', 'text-align style -> class');
eq(clean('<p class="evil-class">x</p>'), '<p>x</p>', 'unknown class dropped entirely');
ok(strpos(clean('<p class="ql-align-center evil">x</p>'), 'evil') === false, 'only the enum value is emitted');

echo "\nstructural rules\n";
eq(clean('<li>stray</li>'), 'stray', 'li outside a list unwraps to text');
// NB: libxml hoists <p> out of <b> during parsing (<b></b><p>x</p>), so that
// case never reaches the guard. These two DO reach it — the parser preserves
// the nesting, and our $allowBlocks=false rule unwraps the block.
eq(clean('<u><ul><li>x</li></ul></u>'), '<u>x</u>', 'list inside inline unwraps (no invalid nesting)');
eq(clean('<strong><blockquote>q</blockquote></strong>'), '<strong>q</strong>', 'blockquote inside inline unwraps');
eq(clean('<span style="color:red"><p>y</p></span>'), '<span style="color:red">y</span>', 'paragraph inside span unwraps');
ok(strpos(clean('<b><p>blocked</p></b>'), 'blocked') !== false, 'parser-hoisted block keeps its content');
eq(clean('<p></p>'), '', 'empty block dropped');
eq(clean('<ul></ul>'), '', 'empty list dropped');

echo "\nbackward compatibility (existing execCommand editor output)\n";
eq(clean('line1<div>line2</div>'), 'line1<br>line2', 'div still becomes a line break');
eq(clean('<div><br></div>'), '', 'empty div line collapses');
eq(clean('<font color="#ff0000">red</font>'), '<span style="color:#ff0000">red</span>', 'legacy font -> span');
eq(clean('<span style="font-size:18px">big</span>'), '<span style="font-size:18px">big</span>', 'span size kept');
eq(clean('<b>b</b><i>i</i><u>u</u>'), '<strong>b</strong><em>i</em><u>u</u>', 'inline synonyms canonicalised');
eq(clean('<span style="font-size:19px">x</span>'), '<span style="font-size:18px">x</span>', 'odd size snaps to allowed set');

echo "\nidempotence (job descriptions re-sanitize on every update)\n";
$samples = [
    '<ul><li>one</li><li>two</li></ul>',
    '<p class="rt-align-center">centered</p>',
    '<a href="https://example.com">link</a>',
    '<h2>Head</h2><blockquote>q</blockquote><pre>code</pre>',
    'line1<div>line2</div>',
    '<span style="color:#ff0000;font-size:24px">styled</span>',
];
foreach ($samples as $s) {
    $once = clean($s);
    $twice = clean($once);
    eq($twice, $once, 'stable under re-clean: ' . substr(strip_tags($s), 0, 18));
}

echo "\ntoPlain (block boundaries must not run words together)\n";
eq(RichText::toPlain('<ul><li>one</li><li>two</li></ul>'), 'one two', 'list items separated');
eq(RichText::toPlain('<p>a</p><p>b</p>'), 'a b', 'paragraphs separated');
eq(RichText::toPlain('<a href="https://e.com">text</a>'), 'text', 'link text only');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
