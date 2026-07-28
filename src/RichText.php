<?php

// =====================================================================
// FILE: src/RichText.php
// A strict HTML sanitizer for user-authored rich text (posts and job
// descriptions). Rich text is dangerous: rendering user HTML without
// sanitizing is a stored-XSS hole. This allows ONLY a whitelist of
// formatting and strips everything else.
//
// Allowed INLINE:
//   <b> <strong> <i> <em> <u>          bold / italic / underline
//   <code>                             inline code
//   <a href>                           links (http/https/mailto ONLY)
//   <br>                               line breaks
//   <span style="color; font-size">    with only safe values
//
// Allowed BLOCK:
//   <p>                                paragraph
//   <h2> <h3>                          headings (h1/h4-h6 clamp onto these)
//   <blockquote>                       quote
//   <pre>                              code block
//   <ul> <ol> <li>                     lists (nestable)
//
// Block elements may carry ONE alignment class from a fixed enum
// (rt-align-center / -right / -justify). No attacker-controlled value is
// ever echoed into a class or style.
//
// Everything else — scripts, event handlers, images, iframes, arbitrary
// tags/attributes, javascript:/data: urls — is removed. We parse with
// DOMDocument rather than regex (regex HTML sanitizers are notoriously
// bypassable).
//
// IDEMPOTENCE: clean() is safe to run on its own output. Job descriptions
// get re-sanitized on every update, so output must survive re-cleaning
// unchanged.
// =====================================================================

class RichText
{
    /** Inline tags allowed in output. */
    private const INLINE_TAGS = [
        'b' => true, 'strong' => true,
        'i' => true, 'em' => true,
        'u' => true,
        'code' => true,
        'a' => true,
        'br' => true,
        'span' => true,   // only for color / font-size styles
        'font' => true,   // legacy execCommand output; converted to span
    ];

    /** Block tags allowed in output. */
    private const BLOCK_TAGS = [
        'p' => true,
        'h1' => true, 'h2' => true, 'h3' => true,
        'h4' => true, 'h5' => true, 'h6' => true,
        'blockquote' => true,
        'pre' => true,
        'ul' => true, 'ol' => true, 'li' => true,
        'div' => true,    // legacy: contentEditable line wrapper -> <br>
    ];

    /** Headings are clamped to two levels; posts must not emit <h1>. */
    private const HEADING_MAP = [
        'h1' => 'h2', 'h2' => 'h2',
        'h3' => 'h3', 'h4' => 'h3', 'h5' => 'h3', 'h6' => 'h3',
    ];

    /**
     * Alignment: a FIXED enum. We accept Quill's ql-align-* classes, our own
     * canonical rt-align-* (so re-cleaning is idempotent), and a text-align
     * inline style — all normalised to one canonical class. Nothing the user
     * supplies is ever echoed verbatim.
     */
    private const ALIGN_MAP = [
        'ql-align-center'  => 'rt-align-center',
        'ql-align-right'   => 'rt-align-right',
        'ql-align-justify' => 'rt-align-justify',
        'rt-align-center'  => 'rt-align-center',
        'rt-align-right'   => 'rt-align-right',
        'rt-align-justify' => 'rt-align-justify',
        'center'           => 'rt-align-center',
        'right'            => 'rt-align-right',
        'justify'          => 'rt-align-justify',
    ];

    // Allowed font sizes (px). We clamp to a small set so users can't set
    // absurd sizes that break layout.
    private const ALLOWED_SIZES = [12, 14, 16, 18, 24, 32];

    /**
     * Sanitize a rich-text HTML string. Returns safe HTML (a subset of the
     * input) or '' if empty. Length is capped by the caller.
     */
    public static function clean(string $html): string
    {
        $html = trim($html);
        if ($html === '') return '';

        // Normalise: strip NULs and control chars that can confuse parsers,
        // and zero-width spaces (used by the editor as caret anchors).
        $html = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $html);
        $html = str_replace("\xE2\x80\x8B", '', $html);   // U+200B

        // Wrap so DOMDocument has a single root and a known encoding.
        $wrapped = '<?xml encoding="UTF-8"><div id="__root__">' . $html . '</div>';

        $dom = new DOMDocument();
        libxml_use_internal_errors(true);   // ignore malformed-HTML warnings
        $dom->loadHTML($wrapped, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();

        // Find our wrapper div reliably (getElementById needs declared ID
        // types, which we can't guarantee from loadHTML).
        $root = null;
        foreach ($dom->getElementsByTagName('div') as $d) {
            if ($d->getAttribute('id') === '__root__') { $root = $d; break; }
        }
        if (!$root) return '';

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= self::renderNode($child, true, false);
        }

        // Collapse excessive break runs, strip a leading break (the first
        // block shouldn't begin with a blank line), and trim.
        $out = preg_replace('#(<br>\s*){3,}#', '<br><br>', $out);
        $out = preg_replace('#^(\s*<br>\s*)+#', '', $out);
        return trim($out);
    }

    /**
     * Recursively render an allowed node to safe HTML.
     *
     * @param bool $allowBlocks  false inside inline elements, so a block
     *                           nested in <b> is unwrapped rather than
     *                           producing invalid markup.
     * @param bool $inList       true directly inside <ul>/<ol>, which is the
     *                           only place <li> is meaningful.
     */
    private static function renderNode(DOMNode $node, bool $allowBlocks, bool $inList): string
    {
        // Text node: escape it.
        if ($node->nodeType === XML_TEXT_NODE) {
            return htmlspecialchars($node->nodeValue, ENT_QUOTES, 'UTF-8');
        }
        if ($node->nodeType !== XML_ELEMENT_NODE) {
            return '';   // comments, PIs, etc. -> dropped
        }

        /** @var DOMElement $node */
        $tag = strtolower($node->nodeName);

        $isInline = isset(self::INLINE_TAGS[$tag]);
        $isBlock  = isset(self::BLOCK_TAGS[$tag]);

        // Disallowed tag, or a block where blocks aren't permitted:
        // drop the tag but keep its (sanitized) content.
        if ((!$isInline && !$isBlock) || ($isBlock && !$allowBlocks)) {
            return self::renderChildren($node, $allowBlocks, false);
        }

        // <br> is self-closing.
        if ($tag === 'br') return '<br>';

        // ---- legacy line model -------------------------------------------
        // contentEditable (the current execCommand editor) wraps each new
        // line in a <div>. A block always starts on a new line, so emit a
        // <br> BEFORE its content. Kept so the existing editor is unaffected.
        if ($tag === 'div') {
            $inner = self::renderChildren($node, true, false);
            if (trim(strip_tags($inner)) === '' && strpos($inner, '<br>') === false) {
                return '<br>';
            }
            return '<br>' . $inner;
        }

        // ---- lists --------------------------------------------------------
        if ($tag === 'ul' || $tag === 'ol') {
            // Only <li> children are meaningful; anything else is unwrapped
            // into an implicit item so no content is silently lost.
            $inner = '';
            foreach (iterator_to_array($node->childNodes) as $c) {
                $inner .= self::renderNode($c, true, true);
            }
            if (trim(strip_tags($inner)) === '') return '';
            return '<' . $tag . self::alignAttr($node) . '>' . $inner . '</' . $tag . '>';
        }

        if ($tag === 'li') {
            // An <li> outside a list is unwrapped to its content.
            $inner = self::renderChildren($node, true, false);
            if (!$inList) return $inner;
            if ($inner === '') return '';
            return '<li>' . $inner . '</li>';
        }

        // ---- other blocks --------------------------------------------------
        if ($tag === 'blockquote' || $tag === 'pre' || $tag === 'p' || isset(self::HEADING_MAP[$tag])) {
            // <pre> holds preformatted text; keep inline formatting minimal
            // but don't allow nested blocks inside it.
            $inner = ($tag === 'pre')
                ? self::renderChildren($node, false, false)
                : self::renderChildren($node, true, false);

            if (trim(strip_tags($inner)) === '' && strpos($inner, '<br>') === false) {
                return '';   // empty block -> drop
            }
            $out = isset(self::HEADING_MAP[$tag]) ? self::HEADING_MAP[$tag] : $tag;
            return '<' . $out . self::alignAttr($node) . '>' . $inner . '</' . $out . '>';
        }

        // ---- inline --------------------------------------------------------
        $inner = self::renderChildren($node, false, false);

        // <a href> — links are the highest-risk allowance. Only absolute
        // http/https and mailto survive; anything else unwraps to its text.
        if ($tag === 'a') {
            if ($inner === '') return '';
            $href = self::safeHref($node->getAttribute('href'));
            if ($href === null) return $inner;   // unsafe/relative -> plain text
            return '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8')
                 . '" rel="nofollow noopener noreferrer" target="_blank">' . $inner . '</a>';
        }

        // <span> may carry a sanitized style (color + font-size only).
        if ($tag === 'span') {
            if ($inner === '') return '';
            $style = self::safeStyle($node->getAttribute('style'));
            return $style !== ''
                ? '<span style="' . $style . '">' . $inner . '</span>'
                : $inner;   // no allowed style -> unwrap
        }

        // <font color="..."> from legacy execCommand -> convert to a span.
        if ($tag === 'font') {
            if ($inner === '') return '';
            $styles = [];
            $color = self::normalizeColor($node->getAttribute('color'));
            if ($color !== null) $styles[] = 'color:' . $color;
            $fromStyle = self::safeStyle($node->getAttribute('style'));
            if ($fromStyle !== '') $styles[] = $fromStyle;
            $style = implode(';', $styles);
            return $style !== ''
                ? '<span style="' . $style . '">' . $inner . '</span>'
                : $inner;
        }

        // Normalise synonyms to canonical tags.
        $canonical = ['strong' => 'strong', 'b' => 'strong', 'em' => 'em', 'i' => 'em',
                      'u' => 'u', 'code' => 'code'][$tag] ?? $tag;

        if ($inner === '') return '';
        return '<' . $canonical . '>' . $inner . '</' . $canonical . '>';
    }

    /** Render every child of a node. */
    private static function renderChildren(DOMNode $node, bool $allowBlocks, bool $inList): string
    {
        $out = '';
        foreach (iterator_to_array($node->childNodes) as $c) {
            $out .= self::renderNode($c, $allowBlocks, $inList);
        }
        return $out;
    }

    /**
     * Return ' class="rt-align-x"' for a block carrying a recognised
     * alignment, or '' otherwise. The emitted value comes from a fixed enum
     * — never from user input.
     */
    private static function alignAttr(DOMElement $node): string
    {
        // 1. class="ql-align-center" / "rt-align-center"
        $classes = preg_split('/\s+/', strtolower(trim($node->getAttribute('class'))));
        foreach ($classes as $c) {
            if ($c !== '' && isset(self::ALIGN_MAP[$c])) {
                return ' class="' . self::ALIGN_MAP[$c] . '"';
            }
        }
        // 2. style="text-align:center"
        $style = $node->getAttribute('style');
        if ($style !== '' && preg_match('/text-align\s*:\s*([a-z]+)/i', $style, $m)) {
            $key = strtolower($m[1]);
            if (isset(self::ALIGN_MAP[$key])) {
                return ' class="' . self::ALIGN_MAP[$key] . '"';
            }
        }
        return '';
    }

    /**
     * Validate a link target. WHITELIST ONLY: absolute http/https, or
     * mailto. Because we whitelist rather than blacklist, obfuscated
     * javascript:/data: payloads fail automatically — there is no scheme
     * blacklist to bypass.
     */
    private static function safeHref(string $href): ?string
    {
        // Control characters and whitespace can hide a scheme
        // ("java\tscript:"). Strip them, then decode entities, then strip
        // again (entities can re-introduce control characters).
        $h = preg_replace('/[\x00-\x20\x7F]+/', '', $href);
        $h = html_entity_decode($h, ENT_QUOTES, 'UTF-8');
        $h = preg_replace('/[\x00-\x20\x7F]+/', '', $h);
        if ($h === '' || strlen($h) > 2000) return null;

        if (preg_match('#^https?://[^\s<>"]+$#i', $h))       return $h;
        if (preg_match('#^mailto:[^\s<>"@]+@[^\s<>"@]+$#i', $h)) return $h;
        return null;
    }

    /**
     * Return a safe style string containing ONLY an allowed color and/or
     * font-size, or '' if neither is valid.
     */
    private static function safeStyle(string $style): string
    {
        if ($style === '') return '';
        $parts = [];

        // color: hex, rgb(), or a conservative set of named colors.
        if (preg_match('/(?<!-)\bcolor\s*:\s*([^;]+)/i', $style, $m)) {
            $color = self::normalizeColor(trim($m[1]));
            if ($color !== null) {
                $parts[] = 'color:' . $color;
            }
        }

        // font-size: a number of px that we clamp to the allowed set.
        if (preg_match('/font-size\s*:\s*(\d+)\s*px/i', $style, $m)) {
            $size = (int) $m[1];
            $best = self::ALLOWED_SIZES[0];
            foreach (self::ALLOWED_SIZES as $s) {
                if (abs($s - $size) < abs($best - $size)) $best = $s;
            }
            $parts[] = 'font-size:' . $best . 'px';
        }

        return implode(';', $parts);
    }

    /**
     * Normalize a color to a safe hex/named value, or null if unsafe.
     */
    private static function normalizeColor(string $color): ?string
    {
        $color = trim($color);

        if (preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $color)) {
            return $color;
        }

        if (preg_match('/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i', $color, $m)) {
            $r = min(255, (int) $m[1]);
            $g = min(255, (int) $m[2]);
            $b = min(255, (int) $m[3]);
            return sprintf('#%02x%02x%02x', $r, $g, $b);
        }

        $named = [
            'black','white','red','green','blue','orange','purple','teal',
            'gray','grey','navy','maroon','olive','lime','aqua','fuchsia',
            'silver','yellow','brown','pink',
        ];
        if (in_array(strtolower($color), $named, true)) {
            return strtolower($color);
        }

        return null;
    }

    /**
     * Strip ALL tags to a plain-text preview (for feed snippets, search,
     * notifications, etc. where formatting isn't wanted). Block boundaries
     * become spaces so list items and paragraphs don't run together.
     */
    public static function toPlain(string $html): string
    {
        $text = preg_replace('#<br\s*/?>#i', ' ', $html);
        // Closing block tags are word boundaries in plain text.
        $text = preg_replace('#</(p|li|ul|ol|h2|h3|blockquote|pre|div)\s*>#i', ' ', $text);
        $text = strip_tags($text);
        $text = html_entity_decode($text, ENT_QUOTES, 'UTF-8');
        return trim(preg_replace('/\s+/', ' ', $text));
    }
}
